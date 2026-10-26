"""Schema migrations (Alembic) over the hand-written SQL in `alembic/sql/`.

- Each revision `NNNN_<slug>` runs `alembic/sql/NNNN_<slug>.{up,down}.sql` verbatim, in its own
  transaction. Autogenerate is never used: the SQL files are the schema's source of truth.
- The SQL grants to the placeholder role `app_rw`; it is swapped for the runtime role (the user
  in DATABASE_URL) as the file runs (D-106), so a shared server can give each app its own roles.
- A session advisory lock (same key as before) serialises concurrent boots.
- Only this module ever uses DATABASE_OWNER_URL; its connection is closed on return.
"""

import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.core.database import SCHEMA, sqlalchemy_url

BACKEND_DIR = Path(__file__).resolve().parents[2]
ALEMBIC_DIR = BACKEND_DIR / "alembic"
SQL_DIR = ALEMBIC_DIR / "sql"
ADVISORY_LOCK_KEY = 72_310_001
PLACEHOLDER_ROLE = "app_rw"
_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
_PLACEHOLDER = re.compile(r"\bapp_rw\b")


def app_role_of(database_url: str) -> str:
    """The runtime role the migrations grant to: the user DATABASE_URL connects as."""
    return unquote(urlsplit(database_url).username or "")


def for_role(sql: str, role: str) -> str:
    """A migration's SQL with the placeholder role replaced by `role` (D-106)."""
    # A bare identifier only: it goes into GRANT/REVOKE unquoted, so nothing else may get through.
    if not _ROLE.match(role):
        raise ValueError(
            f'database role "{role}" must be lower-case letters, digits and _ (max 63)'
        )
    return _PLACEHOLDER.sub(role, sql)


def read_sql(revision: str, direction: str) -> str:
    return (SQL_DIR / f"{revision}.{direction}.sql").read_text(encoding="utf-8")


def run_sql_file(revision: str, direction: str) -> None:
    """Called from a revision's upgrade()/downgrade(): run the file through the raw driver.

    No SQLAlchemy `text()` and no parameters, so `:name`, `%` and `$$` bodies reach PostgreSQL
    untouched and the file may hold several statements (psycopg's simple query path).
    """
    from alembic import context, op

    role = context.config.attributes.get("app_role", PLACEHOLDER_ROLE)
    sql = for_role(read_sql(revision, direction), role)
    raw: Any = op.get_bind().connection.driver_connection
    raw.execute(sql)
    # The previous runner's bookkeeping is kept in step, so a database migrated here is still
    # the state the last Node image expects: rolling back to that image stays possible (D-109).
    # 0001 creates `schema_migration` and its downgrade drops it.
    if raw.execute("SELECT to_regclass('schema_migration')").fetchone()[0]:
        if direction == "up":
            raw.execute(
                "INSERT INTO schema_migration (id) VALUES (%s) ON CONFLICT DO NOTHING", (revision,)
            )
        else:
            raw.execute("DELETE FROM schema_migration WHERE id = %s", (revision,))


def alembic_config(owner_url: str, app_role: str) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.attributes["owner_url"] = owner_url
    cfg.attributes["app_role"] = app_role
    return cfg


def _current(owner_url: str) -> str | None:
    engine = create_engine(sqlalchemy_url(owner_url), poolclass=NullPool)
    try:
        with engine.connect() as conn:
            if conn.execute(text("SELECT to_regclass('alembic_version')")).scalar():
                return MigrationContext.configure(conn).get_current_revision()
            # Not yet bridged (env.py stamps it): the previous runner's bookkeeping.
            if conn.execute(text("SELECT to_regclass('schema_migration')")).scalar():
                last = conn.execute(text("SELECT max(id) FROM schema_migration")).scalar()
                return str(last) if last else None
            return None
    finally:
        engine.dispose()


def ensure_schema(owner_url: str, app_role: str = PLACEHOLDER_ROLE) -> list[str]:
    """TT Suite: Kanban lives in schema `kanban`. A database from before has Kanban in `public`;
    the first boot moves it, in one transaction (all or nothing): every table (with its rows,
    indexes, constraints, triggers and owned sequences), then the standalone sequences, types
    and functions. Objects that belong to an extension stay where they are. Moving only changes
    the schema label: no data is copied, and grants travel with each object.
    Returns the names moved (empty once `kanban` exists)."""
    for_role("", app_role)
    engine = create_engine(sqlalchemy_url(owner_url), poolclass=NullPool)
    moved: list[str] = []
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": ADVISORY_LOCK_KEY})
            conn.commit()
            try:
                with conn.begin():
                    if not conn.execute(text("SELECT 1 FROM pg_namespace WHERE nspname = :s"), {"s": SCHEMA}).scalar():
                        conn.execute(text(f"CREATE SCHEMA {SCHEMA}"))
                        legacy = conn.execute(
                            text("SELECT to_regclass('public.alembic_version') IS NOT NULL"
                                 " OR to_regclass('public.schema_migration') IS NOT NULL")
                        ).scalar()
                        if legacy:
                            moved = _move_from_public(conn)
                    conn.execute(text(f"GRANT USAGE ON SCHEMA {SCHEMA} TO {app_role}"))
            finally:
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADVISORY_LOCK_KEY})
                conn.commit()
    finally:
        engine.dispose()
    return moved


_NOT_EXTENSION = "NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = {oid} AND d.deptype = 'e')"
_MOVABLE = {
    # relations: a table takes its indexes, constraints, triggers and owned sequences with it
    "relation": (
        "SELECT CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'"
        " WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, quote_ident(c.relname)"
        " FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
        " WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')"
        " AND " + _NOT_EXTENSION.format(oid="c.oid")
    ),
    "sequence": (
        "SELECT 'SEQUENCE', quote_ident(c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
        " WHERE n.nspname = 'public' AND c.relkind = 'S' AND " + _NOT_EXTENSION.format(oid="c.oid")
    ),
    "type": (
        "SELECT 'TYPE', quote_ident(t.typname) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace"
        " WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c')"
        " AND NOT EXISTS (SELECT 1 FROM pg_class cl WHERE cl.reltype = t.oid)"
        " AND " + _NOT_EXTENSION.format(oid="t.oid")
    ),
    "routine": (
        "SELECT 'ROUTINE', quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')'"
        " FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace"
        " WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') AND " + _NOT_EXTENSION.format(oid="p.oid")
    ),
}


def _move_from_public(conn: Any) -> list[str]:
    moved: list[str] = []
    for query in _MOVABLE.values():  # in order: sequences left after the tables moved theirs
        for kind, name in conn.execute(text(query)).all():
            conn.execute(text(f"ALTER {kind} public.{name} SET SCHEMA {SCHEMA}"))
            moved.append(name)
    return moved


def migrate_up(owner_url: str, app_role: str = PLACEHOLDER_ROLE) -> list[str]:
    """Apply every pending migration. Returns the ids applied in this call, oldest first."""
    for_role("", app_role)  # refuse a bad name before touching the database
    ensure_schema(owner_url, app_role)
    cfg = alembic_config(owner_url, app_role)
    before = _current(owner_url)
    command.upgrade(cfg, "head")
    after = _current(owner_url)
    if before == after:
        return []
    script = ScriptDirectory.from_config(cfg)
    applied = [r.revision for r in script.iterate_revisions(after, before)]
    return list(reversed(applied))


def migrate_down(owner_url: str, count: int = 1, app_role: str = PLACEHOLDER_ROLE) -> None:
    """Revert the last `count` applied migrations."""
    for_role("", app_role)
    ensure_schema(owner_url, app_role)
    command.downgrade(alembic_config(owner_url, app_role), f"-{count}")
