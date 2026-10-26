"""Alembic environment: owner connection, advisory lock, one transaction per migration, and a
one-time bridge from the previous runner's `schema_migration` table."""

from alembic import context
from sqlalchemy import Connection, create_engine, pool, text

from app.core.config import load_settings
from app.core.database import sqlalchemy_url
from app.db.migrate import ADVISORY_LOCK_KEY, app_role_of

config = context.config


def _owner_url() -> str:
    url = config.attributes.get("owner_url")
    if url:
        return str(url)
    # `alembic upgrade head` from the command line: read the environment like the app does.
    settings = load_settings()
    config.attributes.setdefault("app_role", app_role_of(settings.DATABASE_URL))
    return settings.DATABASE_OWNER_URL


def _bridge_from_schema_migration(conn: Connection) -> None:
    """A database migrated by the previous runner has `schema_migration` but no
    `alembic_version`: stamp it at the last id it applied (ids and revisions are the same).
    `schema_migration` is left as it is."""
    has_alembic = conn.execute(text("SELECT to_regclass('alembic_version')")).scalar()
    has_legacy = conn.execute(text("SELECT to_regclass('schema_migration')")).scalar()
    if has_alembic or not has_legacy:
        return
    applied = [r[0] for r in conn.execute(text("SELECT id FROM schema_migration ORDER BY id"))]
    if not applied:
        return
    script = context.script
    chain = [r.revision for r in reversed(list(script.walk_revisions()))]
    if applied != chain[: len(applied)]:
        raise RuntimeError(
            f"schema_migration holds {applied}, which is not a prefix of {chain}; refusing to stamp"
        )
    conn.execute(
        text(
            "CREATE TABLE alembic_version (version_num varchar(32) NOT NULL,"
            " CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        )
    )
    conn.execute(text("INSERT INTO alembic_version (version_num) VALUES (:v)"), {"v": applied[-1]})
    conn.commit()


def run_migrations_online() -> None:
    engine = create_engine(sqlalchemy_url(_owner_url()), poolclass=pool.NullPool)
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(:k)"), {"k": ADVISORY_LOCK_KEY})
        conn.commit()
        try:
            _bridge_from_schema_migration(conn)
            context.configure(connection=conn, transaction_per_migration=True)
            with context.begin_transaction():
                context.run_migrations()
            conn.commit()
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": ADVISORY_LOCK_KEY})
            conn.commit()
    engine.dispose()


if context.is_offline_mode():
    raise SystemExit("offline (--sql) mode is not supported: migrations run raw SQL files")
run_migrations_online()
