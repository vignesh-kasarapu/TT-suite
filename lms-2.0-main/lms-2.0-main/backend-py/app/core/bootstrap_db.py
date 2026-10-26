"""Ensures schema `lms` exists, runs every Alembic migration, grants the runtime role
access, and seeds reference data into a fresh schema.

Run before Uvicorn starts (`python -m app` does it; so does entrypoint.sh). The database
itself is the suite's shared PostgreSQL and is never created here — the portal's
deploy owns it. Migrations run in-process (alembic.command.upgrade) as the schema
owner (DATABASE_OWNER_URL); an advisory lock serialises concurrent boots.
"""
import pathlib

import psycopg
from alembic import command
from alembic.config import Config
from suite_core.migrate import grant_schema, libpq_url, role_of

from app.core.config import DB_SCHEMA, settings

BACKEND_PY_ROOT = pathlib.Path(__file__).resolve().parents[2]
ALEMBIC_INI_PATH = BACKEND_PY_ROOT / "alembic.ini"
LOCK_KEY = 72_310_903  # suite_core uses 72_310_900 for `suite`; one key per schema


def _alembic_config() -> Config:
    cfg = Config(str(ALEMBIC_INI_PATH))
    cfg.set_main_option("script_location", str(BACKEND_PY_ROOT / "alembic"))
    # '%' must be escaped for ConfigParser interpolation (passwords may contain it).
    cfg.set_main_option("sqlalchemy.url", settings.owner_database_uri.replace("%", "%%"))
    return cfg


def ensure_schema() -> None:
    with psycopg.connect(libpq_url(settings.owner_database_uri), autocommit=True) as conn:
        conn.execute(f"CREATE SCHEMA IF NOT EXISTS {DB_SCHEMA}")


def run_migrations() -> None:
    command.upgrade(_alembic_config(), "head")


def grant_runtime_role() -> None:
    runtime_role = role_of(settings.sqlalchemy_database_uri)
    if runtime_role:
        grant_schema(settings.owner_database_uri, DB_SCHEMA, runtime_role)


def seed_if_empty() -> bool:
    """A fresh schema gets the reference data (roles, leave types, current leave year,
    config defaults, templates). Only when `roles` is empty, so a running system's
    leave years are never touched by a reboot. Returns True when it seeded."""
    with psycopg.connect(libpq_url(settings.owner_database_uri)) as conn:
        count = conn.execute(f"SELECT count(*) FROM {DB_SCHEMA}.roles").fetchone()[0]
    if count:
        return False
    import sys

    if str(BACKEND_PY_ROOT) not in sys.path:
        sys.path.insert(0, str(BACKEND_PY_ROOT))
    from scripts import seed

    seed.run()
    return True


def bootstrap() -> None:
    with psycopg.connect(libpq_url(settings.owner_database_uri), autocommit=True) as lock_conn:
        lock_conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
        try:
            ensure_schema()
            run_migrations()
            grant_runtime_role()
            seed_if_empty()
        finally:
            lock_conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))


if __name__ == "__main__":
    bootstrap()
    print(f"OK: schema '{DB_SCHEMA}' exists, is migrated to head and granted.")
