"""Portal settings. Names follow Kanban's deployment contract so the existing App Service settings
(ENTRA_*, MAIL_*, APP_SECRET, PUBLIC_BASE_URL, APP_PROFILE) carry over unchanged.

prod refuses the dev-only switches, with a reason that names the key (never the value).
"""

import os
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Profile = Literal["dev", "test", "prod"]
SECRET_KEYS = frozenset(
    {"DATABASE_URL", "DATABASE_OWNER_URL", "ENTRA_CLIENT_SECRET", "APP_SECRET", "MAIL_PASSWORD", "INTERNAL_TOKEN"}
)
SUITE_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_ignore_empty=True, extra="ignore", frozen=True)

    APP_PROFILE: Profile = "dev"
    PORT: int = 8000
    PUBLIC_BASE_URL: str = "http://localhost:8000"
    LOG_LEVEL: str = "info"
    DATABASE_URL: str = "postgresql://app_rw:dev@localhost:5433/ttsuite"
    DATABASE_OWNER_URL: str = "postgresql://app_owner:dev@localhost:5433/ttsuite"
    DB_POOL_SIZE: int = Field(default=5, ge=1)

    # entra = Microsoft sign-in (Kanban's app registration); dev = name picker (never in prod).
    AUTH_PROVIDER: Literal["entra", "dev"] = "dev"
    ENTRA_TENANT_ID: str = ""
    ENTRA_CLIENT_ID: str = ""
    ENTRA_CLIENT_SECRET: str = ""
    ENTRA_REDIRECT_URI: str = ""
    # Session length: SESSION_IDLE_HOURS (24) without use, SESSION_MAX_DAYS (30) at most. Read from the
    # environment by suite_core.identity, so every app slides and ends sessions the same way.
    # base64 32-byte AES-256-GCM key (the OIDC in-flight cookie), as Kanban.
    APP_SECRET: str = ""

    # The global admin made at boot (and given admin in every app).
    SEED_GLOBAL_ADMIN_EMAIL: str = ""
    # Local seed people (JSON, relative to the TT-suite root), e.g. deploy/seed.json. Never packaged.
    SEED_FILE: str = ""
    # Shared secret for the portal -> app /internal/* calls (localhost only).
    INTERNAL_TOKEN: str = ""
    KANBAN_URL: str = "http://127.0.0.1:8002"
    LMS_URL: str = "http://127.0.0.1:8003"
    EXPENSE_URL: str = "http://127.0.0.1:8004"
    AMS_URL: str = "http://127.0.0.1:8005"
    RESUME_URL: str = "http://127.0.0.1:8006"

    # Kanban's mail stack (D-132): stub (dev only) | graph | smtp.
    MAIL_PROVIDER: Literal["stub", "graph", "smtp"] = "stub"
    MAIL_SENDER: str = "kanban@example.test"
    MAIL_HOST: str = ""
    MAIL_PORT: int = Field(default=587, ge=1, le=65535)
    MAIL_USERNAME: str = ""
    MAIL_PASSWORD: str = ""
    SMTP_FROM_ADDRESS: str = ""
    MAIL_FROM_NAME: str = "Tektalis Suite"

    # Built SPAs: <STATIC_DIR>/{portal,kanban,lms,expense}/index.html
    STATIC_DIR: str = str(SUITE_ROOT / "dist-suite" / "static")

    @model_validator(mode="after")
    def _guard(self) -> "Settings":
        if self.APP_PROFILE == "prod":
            refused = [
                label
                for label, bad in (
                    ("AUTH_PROVIDER=dev", self.AUTH_PROVIDER == "dev"),
                    ("MAIL_PROVIDER=stub", self.MAIL_PROVIDER == "stub"),
                    ("INTERNAL_TOKEN unset", not self.INTERNAL_TOKEN),
                    ("APP_SECRET unset", not self.APP_SECRET),
                )
                if bad
            ]
            if refused:
                raise ValueError(f"APP_PROFILE=prod refuses: {', '.join(refused)}")
        if self.AUTH_PROVIDER == "entra":
            missing = [
                k
                for k in ("ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_REDIRECT_URI", "APP_SECRET")
                if not getattr(self, k)
            ]
            if missing:
                raise ValueError(f"AUTH_PROVIDER=entra needs {', '.join(missing)}")
        if self.MAIL_PROVIDER == "smtp":
            missing = [k for k in ("MAIL_HOST", "MAIL_USERNAME", "MAIL_PASSWORD") if not getattr(self, k)]
            if missing:
                raise ValueError(f"MAIL_PROVIDER=smtp needs {', '.join(missing)}")
        return self

    def app_url(self, app: str) -> str:
        return {"kanban": self.KANBAN_URL, "lms": self.LMS_URL, "expense": self.EXPENSE_URL, "ams": self.AMS_URL,
                "resume": self.RESUME_URL}[app]

    def public_config(self) -> dict[str, object]:
        return {k: v for k, v in self.model_dump().items() if k not in SECRET_KEYS}


# Under the suite (deploy/run.py sets SUITE_ENV_ONLY) every value comes from the one TT-suite/.env;
# a local .env is read only when the app runs on its own.
ENV_FILE = None if os.environ.get("SUITE_ENV_ONLY") else ".env"


def load_settings(overrides: dict[str, str] | None = None, *, env_file: str | None = ENV_FILE) -> Settings:
    clean = {k: v for k, v in (overrides or {}).items() if v != ""}
    try:
        return Settings(_env_file=env_file, **clean)  # type: ignore[arg-type]
    except ValidationError as err:
        reasons = [str(e["msg"]).removeprefix("Value error, ") for e in err.errors()]
        raise ValueError("; ".join(reasons)) from None
