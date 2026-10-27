import os
from typing import List
from urllib.parse import urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict

SCHEMA = "ams"  # every AMS table lives here; the suite's global tables are always written app.*
APP = "ams"  # this app's name in the TT Suite (app.app_access.app)
# Under the suite (deploy/run.py sets SUITE_ENV_ONLY) every value comes from the one TT-suite/.env;
# a local .env is read only when the app runs on its own.
ENV_FILE = None if os.environ.get("SUITE_ENV_ONLY") else ".env"


def sqlalchemy_url(url: str) -> str:
    """postgres:// | postgresql:// -> postgresql+psycopg:// (psycopg 3)."""
    parts = urlsplit(url)
    if parts.scheme.split("+")[0] in ("postgres", "postgresql"):
        parts = parts._replace(scheme="postgresql+psycopg")
    return urlunsplit(parts)


class Settings(BaseSettings):
    """Values come from the environment (deploy/run.py in the TT Suite) or backend/.env.
    Defaults are for local development against the suite's Postgres (deploy/docker-compose.yml)."""

    PROJECT_NAME: str = "Tektalis Asset Management System"
    VERSION: str = "1.0.0"
    API_V1_PREFIX: str = "/api/v1"

    APP_PROFILE: str = "dev"  # dev | test | prod
    # Runtime role (DML only) and the owner role that runs the migrations (empty = DATABASE_URL).
    DATABASE_URL: str = "postgresql+psycopg://app_rw:dev@localhost:5433/ttsuite"
    DATABASE_OWNER_URL: str = ""
    # Shared secret for the portal -> AMS /internal/* routes. Empty refuses every internal call.
    INTERNAL_TOKEN: str = ""
    HOST: str = "127.0.0.1"
    PORT: int = 8005
    # Only needed when the UI is served from another origin (the Vite dev server).
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def db_url(self) -> str:
        return sqlalchemy_url(self.DATABASE_URL)

    @property
    def owner_db_url(self) -> str:
        return sqlalchemy_url(self.DATABASE_OWNER_URL or self.DATABASE_URL)

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


settings = Settings()
