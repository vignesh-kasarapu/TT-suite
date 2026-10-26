"""Boot-time migrations: Alembic (as the owner role, in schema `expense`), then grant the runtime role."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from suite_core.migrate import grant_schema, role_of

from app.core.config import SCHEMA, settings

BACKEND = Path(__file__).resolve().parents[2]


def alembic_config() -> Config:
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    return cfg


def run_migrations() -> None:
    command.upgrade(alembic_config(), "head")
    grant_schema(settings.owner_db_url, SCHEMA, role_of(settings.db_url))
