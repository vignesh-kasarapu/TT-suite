"""Boot-time migrations: Alembic (as the owner role, in schema `resume`), then grant the runtime role."""
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.config import SCHEMA, settings

BACKEND = Path(__file__).resolve().parents[1]


def alembic_config() -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return cfg


def run_migrations() -> None:
    command.upgrade(alembic_config(), "head")
    if settings.is_postgres:
        from suite_core.migrate import grant_schema, role_of

        grant_schema(settings.owner_db_url, SCHEMA, role_of(settings.db_url))
