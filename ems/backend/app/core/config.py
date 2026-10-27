import os
from urllib.parse import urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

SCHEMA = "expense"  # every EMS table lives here; the suite tables are always schema-qualified
APP = "expense"  # this app's name in the TT Suite (app.app_access.app)
# Under the suite (deploy/run.py sets SUITE_ENV_ONLY) every value comes from the one TT-suite/.env;
# a local .env is read only when the app runs on its own.
ENV_FILE = None if os.environ.get("SUITE_ENV_ONLY") else ".env"


def sqlalchemy_url(url: str) -> str:
    """postgres:// | postgresql:// | postgresql+pg8000:// -> postgresql+psycopg:// (psycopg 3)."""
    parts = urlsplit(url)
    if parts.scheme.split("+")[0] in ("postgres", "postgresql"):
        parts = parts._replace(scheme="postgresql+psycopg")
    return urlunsplit(parts)


class Settings(BaseSettings):
    """Values come from the environment (deploy/run.py in the suite) or backend/.env (copy .env.example).
    Defaults are for local development against the suite's Postgres (TT-suite/deploy/docker-compose.yml)."""

    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    app_profile: str = "dev"  # dev | test | prod
    # Runtime role (DML only). PLACEHOLDER: real connection string per environment.
    database_url: str = "postgresql+psycopg://app_rw:dev@localhost:5433/ttsuite"
    # Owner role that runs the Alembic migrations; empty = use DATABASE_URL.
    database_owner_url: str = ""
    # Shared secret for the portal -> app /internal/* routes. Empty refuses every internal call.
    internal_token: str = ""
    host: str = "127.0.0.1"
    port: int = 8004
    upload_dir: str = "uploads"
    # PLACEHOLDER: comma-separated frontend origins allowed to call the API (only needed when not same-origin)
    cors_origins: str = "http://localhost:5173"
    scheduler_interval_minutes: int = 60

    @property
    def db_url(self) -> str:
        return sqlalchemy_url(self.database_url)

    @property
    def owner_db_url(self) -> str:
        return sqlalchemy_url(self.database_owner_url or self.database_url)

    @property
    def is_prod(self) -> bool:
        return self.app_profile == "prod"


settings = Settings()
