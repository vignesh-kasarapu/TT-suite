"""A tiny forward-only SQL migrator for a schema (used for `app`; apps keep their Alembic).

Files `NNNN_<slug>.up.sql` in a directory run in name order, each in its own transaction,
recorded in `<schema>.schema_version`. A session advisory lock serialises concurrent boots.
The placeholder role `app_rw` in the SQL is replaced by the runtime role (the user in
DATABASE_URL), the same convention as Kanban's migrations (D-106).
"""

import re
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

import psycopg

SQL_DIR = Path(__file__).resolve().parent / "sql"
_ROLE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
_PLACEHOLDER = re.compile(r"\bapp_rw\b")
LOCK_KEY = 72_310_900


def libpq_url(url: str) -> str:
    """postgres:// | postgresql+psycopg:// -> postgresql:// (what psycopg.connect wants)."""
    parts = urlsplit(url)
    return urlunsplit(parts._replace(scheme="postgresql"))


def role_of(database_url: str) -> str:
    return unquote(urlsplit(database_url).username or "")


def for_role(sql: str, role: str) -> str:
    if not _ROLE.match(role):
        raise ValueError(f'database role "{role}" must be lower-case letters, digits and _')
    return _PLACEHOLDER.sub(role, sql)


def migrate(owner_url: str, runtime_role: str, *, schema: str = "app", renamed_from: str | None = "suite",
            sql_dir: Path = SQL_DIR) -> list[str]:
    """Apply pending files; return the ids applied (oldest first).

    The global schema was called `suite` before it became `app`: a database that still has
    `suite` (and no `app`) is renamed once. Tables, data, indexes and grants come along."""
    files = sorted(sql_dir.glob("*.up.sql"))
    applied: list[str] = []
    with psycopg.connect(libpq_url(owner_url), autocommit=True) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
        try:
            if renamed_from:
                names = {r[0] for r in conn.execute(
                    "SELECT nspname FROM pg_namespace WHERE nspname IN (%s, %s)", (schema, renamed_from))}
                if names == {renamed_from}:
                    conn.execute(f"ALTER SCHEMA {renamed_from} RENAME TO {schema}")
            conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
            conn.execute(
                f"CREATE TABLE IF NOT EXISTS {schema}.schema_version "
                "(id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            done = {r[0] for r in conn.execute(f"SELECT id FROM {schema}.schema_version")}
            for f in files:
                rev = f.name.removesuffix(".up.sql")
                if rev in done:
                    continue
                sql = for_role(f.read_text(encoding="utf-8"), runtime_role)
                with conn.transaction():
                    conn.execute(sql)
                    conn.execute(f"INSERT INTO {schema}.schema_version (id) VALUES (%s)", (rev,))
                applied.append(rev)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))
    return applied


def grant_schema(owner_url: str, schema: str, runtime_role: str) -> None:
    """Give the runtime role DML on everything in `schema` (for apps whose own migrations run as
    the owner and do not grant). Idempotent; also covers tables created later by the owner."""
    for_role("", runtime_role)
    with psycopg.connect(libpq_url(owner_url), autocommit=True) as conn:
        owner = conn.execute("SELECT current_user").fetchone()[0]
        if owner == runtime_role:
            return
        conn.execute(f"GRANT USAGE ON SCHEMA {schema} TO {runtime_role}")
        conn.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {schema} TO {runtime_role}")
        conn.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {schema} TO {runtime_role}")
        conn.execute(
            f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {runtime_role}"
        )
        conn.execute(
            f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} GRANT USAGE, SELECT ON SEQUENCES TO {runtime_role}"
        )
