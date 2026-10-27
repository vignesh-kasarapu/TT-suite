"""App settings — mirrors backend/src/config/env.js field-for-field so the
Python backend can run against the same .env conventions as the Node one.

TT Suite: the database is the suite's shared PostgreSQL (LMS tables live in schema
`lms`), sign-in belongs to the portal, and `APP_PROFILE` (dev|test|prod) is the
suite-wide profile. The legacy `ENVIRONMENT` (development|test|production) is
still accepted; whichever one is set drives the other, so existing
`settings.environment == "production"` checks keep meaning "prod"."""
import os
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_PY_ROOT = Path(__file__).resolve().parents[2]

_PROFILE_TO_ENVIRONMENT = {"prod": "production", "test": "test", "dev": "development"}
_ENVIRONMENT_TO_PROFILE = {"production": "prod", "prod": "prod", "test": "test"}

DB_SCHEMA = "lms"
# Under the suite (deploy/run.py sets SUITE_ENV_ONLY) every value comes from the one TT-suite/.env;
# a local .env is read only when the app runs on its own.
ENV_FILE = None if os.environ.get("SUITE_ENV_ONLY") else ".env"


def _sqlalchemy_url(url: str) -> str:
    """postgres:// | postgresql:// -> postgresql+psycopg:// (SQLAlchemy's psycopg 3 driver)."""
    parts = urlsplit(url)
    if parts.scheme in ("postgres", "postgresql", "postgresql+psycopg"):
        return urlunsplit(parts._replace(scheme="postgresql+psycopg"))
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # Suite profile (dev|test|prod). Empty = derive it from ENVIRONMENT.
    app_profile: str = ""
    environment: str = "development"
    # uvicorn bind (see app/__main__.py). In the suite every app listens on
    # 127.0.0.1 behind the portal gateway; LMS's port there is 8003.
    host: str = "127.0.0.1"
    port: int = 8003
    app_base_url: str = "http://localhost:8003"
    client_base_url: str = "http://localhost:5173"
    # Public URL of the LMS behind the gateway (e.g. https://<site>/lms) — used for
    # links in emails. Falls back to client_base_url when unset.
    public_base_url: str = ""

    # Database — the suite's PostgreSQL. DATABASE_URL is the runtime role (DML only),
    # DATABASE_OWNER_URL the role that runs migrations (defaults to DATABASE_URL).
    database_url: str = ""
    database_owner_url: str = ""
    db_pool_size: int = 5
    # Fallback when DATABASE_URL is unset: built from the DB_* parts below.
    db_host: str = "localhost"
    db_port: int = 5433
    db_name: str = "ttsuite"
    db_user: str = "app_rw"
    db_password: str = "dev"
    db_ssl: bool = False

    # Shared secret for the portal -> app /internal/* routes (suite contract §3.2).
    internal_token: str = ""

    # Microsoft Entra ID — the web sign-in now lives in the portal; these remain only
    # for the mobile app's PKCE exchange (POST /api/auth/mobile/token).
    entra_tenant_id: str = ""
    entra_client_id: str = ""
    entra_client_secret: str = ""
    entra_redirect_uri: str = ""

    # Microsoft Entra ID — mobile public client (separate app registration, no secret)
    entra_mobile_client_id: str = ""
    entra_mobile_redirect_uri: str = "lms://auth"

    # Mobile bearer session (the web uses the portal's suite session cookie instead).
    session_jwt_secret: str = "change_me_to_a_long_random_string"

    # Mobile-only dev login (POST /api/auth/dev-login issues a bearer token). MUST default
    # to disabled; refused at boot if enabled in production. The web path has no bypass.
    dev_auth_bypass_enabled: bool = False
    dev_auth_bypass_employee_code: str = ""

    # Disk storage for avatars and leave attachments. On Azure: /home/data/lms.
    storage_dir: str = str(BACKEND_PY_ROOT / "storage")

    # Background jobs (APScheduler). Off for one-off processes/tests if needed.
    scheduler_enabled: bool = True

    # Outbound mail (SMTP)
    mail_host: str = ""
    mail_port: int = 587
    mail_username: str = ""
    mail_password: str = ""
    smtp_from_address: str = "leave-system@yourorg.com"

    # Org defaults (only used as seed data, never hardcoded in business logic)
    default_timezone: str = "Asia/Kolkata"
    default_leave_year_start: str = "04-01"

    @model_validator(mode="after")
    def _align_profile(self):
        profile = self.app_profile.strip().lower()
        if profile:
            if profile not in _PROFILE_TO_ENVIRONMENT:
                raise ValueError(f"APP_PROFILE must be dev, test or prod (got {self.app_profile!r})")
            self.app_profile = profile
            self.environment = _PROFILE_TO_ENVIRONMENT[profile]
        else:
            self.app_profile = _ENVIRONMENT_TO_PROFILE.get(self.environment.strip().lower(), "dev")
        return self

    @property
    def is_production(self) -> bool:
        return self.app_profile == "prod"

    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.database_url:
            return _sqlalchemy_url(self.database_url)
        url = (
            f"postgresql+psycopg://{quote(self.db_user, safe='')}:{quote(self.db_password, safe='')}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )
        return url + ("?sslmode=require" if self.db_ssl else "")

    @property
    def owner_database_uri(self) -> str:
        return _sqlalchemy_url(self.database_owner_url) if self.database_owner_url else self.sqlalchemy_database_uri

    @property
    def link_base_url(self) -> str:
        """Base for links the LMS puts in emails (the SPA behind the gateway)."""
        return (self.public_base_url or self.client_base_url).rstrip("/")


settings = Settings()

if settings.dev_auth_bypass_enabled and settings.is_production:
    # Mirrors backend/src/config/env.js's fatal startup guard exactly — this bypass
    # must never be reachable in production, regardless of a misconfigured env var.
    raise SystemExit(
        "FATAL: DEV_AUTH_BYPASS_ENABLED=true while APP_PROFILE=prod. Refusing to start."
    )
