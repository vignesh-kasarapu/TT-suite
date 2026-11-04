"""Environment settings and the production profile guard.

Every key has a default so the app starts with an empty environment in dev/test. The names,
defaults and refusals are the deployment contract (`Solution/docs/azure-code-deploy.md`), so
they must not drift: prod refuses the dev-only flags with a reason that names the key.
"""

import os
import re
from datetime import datetime
from typing import Literal

from pydantic import Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Profile = Literal["dev", "test", "prod"]

SECRET_KEYS = frozenset(
    {
        "DATABASE_URL",
        "DATABASE_OWNER_URL",
        "ENTRA_CLIENT_SECRET",
        "APP_SECRET",
        "MAIL_PASSWORD",
        "INTERNAL_TOKEN",
    }
)
_RATE = re.compile(r"^(\d+)/(min|hour)$")


def parse_rate(value: str, key: str = "rate") -> tuple[int, int]:
    """'60/min' | '20/hour' -> (max requests, window in seconds)."""
    m = _RATE.match(value.strip())
    if not m:
        raise ValueError(f'{key} must look like "60/min" or "20/hour"')
    return int(m.group(1)), 60 if m.group(2) == "min" else 3600


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_ignore_empty=True, extra="ignore", frozen=True)

    APP_PROFILE: Profile = "dev"
    PORT: int = Field(default=8080, ge=0)
    # TT Suite (SUITE-CONTRACT §1): only the portal gateway on this box talks to Kanban.
    BIND_HOST: str = "127.0.0.1"
    PUBLIC_BASE_URL: str = "http://localhost:8080"
    LOG_LEVEL: str = "info"
    APP_VERSION: str = "dev"
    DATABASE_URL: str = "postgres://app_rw:dev@localhost:5432/app"
    DATABASE_OWNER_URL: str = "postgres://app_owner:dev@localhost:5432/app"
    # TT Suite (SUITE-CONTRACT §3.1): sign-in is the portal's, so the provider is always the
    # suite session. "entra" and "dev" are still accepted (old environments set them) but mean
    # the same thing; nothing reads them any more.
    AUTH_PROVIDER: Literal["suite", "entra", "dev"] = "suite"
    # Mounts POST /auth/dev/sign-in (never in prod). Only the exact string "true" turns it on.
    AUTH_DEV_MODE: bool = False
    # SUITE-CONTRACT §3.2: shared secret for /internal/* (header x-internal-token). Empty refuses
    # every internal call.
    INTERNAL_TOKEN: str = ""
    # LMS on this box (SUITE-CONTRACT §3.2). The time log asks it which days somebody is on
    # leave or on holiday, so a day away from work needs no entry and nobody tells two
    # applications the same thing. Empty turns the lookup off: the time log then shows no
    # days off, exactly as it did before.
    LMS_INTERNAL_URL: str = "http://127.0.0.1:8003"
    # B1 App Service runs four processes on one small box: a small pool per process.
    DB_POOL_SIZE: int = Field(default=5, ge=1, le=50)
    ENTRA_TENANT_ID: str = ""
    ENTRA_CLIENT_ID: str = ""
    ENTRA_CLIENT_SECRET: str = ""
    ENTRA_REDIRECT_URI: str = ""
    # D-129: a session lasts one day from sign-in.
    SESSION_HOURS: int = Field(default=24, ge=0)
    # Email of the user made admin at boot when no such user is admin yet.
    SEED_ADMIN_EMAIL: str = ""
    RL_SIGNIN_IP: str = "10/min"
    RL_HEALTH_IP: str = "60/min"
    RL_DEFAULT_IP: str = "600/min"
    # D-125: messages to the admins from people who cannot sign in.
    RL_CONTACT_IP: str = "5/hour"
    BODY_MAX_JSON: int = Field(default=262144, ge=0)
    # Fixed "now" for dev/test (FakeClock); refused in prod.
    APP_FAKE_NOW: str = ""
    # IANA zone for "today" in reports (D-072).
    ORG_TZ: str = "Asia/Kolkata"
    # stub = dev mailbox (never in prod); graph = Microsoft Graph; smtp = any SMTP server (D-132).
    MAIL_PROVIDER: Literal["stub", "graph", "smtp"] = "stub"
    MAIL_SENDER: str = "kanban@example.test"
    # D-132: SMTP - 587 with STARTTLS, or 465 with TLS from the start.
    MAIL_HOST: str = ""
    MAIL_PORT: int = Field(default=587, ge=1, le=65535)
    MAIL_USERNAME: str = ""
    MAIL_PASSWORD: str = ""
    # The From address (default: MAIL_USERNAME) and the name people see.
    SMTP_FROM_ADDRESS: str = ""
    MAIL_FROM_NAME: str = "Tektalis Kanban"
    # base64 32-byte key for AES-256-GCM (Teams webhook URLs, OIDC flight cookie); empty = off.
    APP_SECRET: str = ""

    @field_validator("AUTH_DEV_MODE", mode="before")
    @classmethod
    def _exact_true(cls, v: object) -> bool:
        return v is True or v == "true"

    @field_validator("RL_SIGNIN_IP", "RL_HEALTH_IP", "RL_DEFAULT_IP", "RL_CONTACT_IP")
    @classmethod
    def _rate(cls, v: str, info: object) -> str:
        parse_rate(v, getattr(info, "field_name", "rate"))
        return v

    @field_validator("APP_FAKE_NOW")
    @classmethod
    def _rfc3339(cls, v: str) -> str:
        if v:
            try:
                datetime.fromisoformat(v)
            except ValueError as err:
                raise ValueError("APP_FAKE_NOW must be an RFC 3339 timestamp") from err
        return v

    @model_validator(mode="after")
    def _profile_guard(self) -> "Settings":
        if self.APP_PROFILE == "prod":
            refused = [
                label
                for label, bad in (
                    ("AUTH_DEV_MODE=true", self.AUTH_DEV_MODE),
                    ("APP_FAKE_NOW", bool(self.APP_FAKE_NOW)),
                    ("MAIL_PROVIDER=stub", self.MAIL_PROVIDER == "stub"),
                )
                if bad
            ]
            if refused:
                raise ValueError(
                    f"APP_PROFILE=prod refuses dev-only configuration: {', '.join(refused)}"
                )
        if self.MAIL_PROVIDER == "smtp":
            missing = [
                k for k in ("MAIL_HOST", "MAIL_USERNAME", "MAIL_PASSWORD") if not getattr(self, k)
            ]
            if missing:
                raise ValueError(f"MAIL_PROVIDER=smtp needs {', '.join(missing)}")
        return self

    @property
    def dev_mode(self) -> bool:
        """Dev sign-in is mounted: never in prod, and only with AUTH_DEV_MODE=true."""
        return self.APP_PROFILE != "prod" and self.AUTH_DEV_MODE

    def public_config(self) -> dict[str, object]:
        """Non-secret view for the boot log (secrets are never logged)."""
        return {k: v for k, v in self.model_dump().items() if k not in SECRET_KEYS}


# Under the suite (deploy/run.py sets SUITE_ENV_ONLY) every value comes from the one TT-suite/.env;
# a local .env is read only when the app runs on its own.
ENV_FILE = None if os.environ.get("SUITE_ENV_ONLY") else ".env"


def load_settings(
    overrides: dict[str, str] | None = None, *, env_file: str | None = ENV_FILE
) -> Settings:
    """Settings from the process environment (and a local `.env` for development, which the
    environment overrides), with explicit overrides on top (tests pass `env_file=None`).

    A refusal names the key and the reason only: Pydantic's own message would echo every input
    value, secrets included.
    """
    clean = {k: v for k, v in (overrides or {}).items() if v != ""}
    try:
        return Settings(_env_file=env_file, **clean)  # type: ignore[arg-type]
    except ValidationError as err:
        reasons = []
        for e in err.errors():
            where = ".".join(str(p) for p in e["loc"])
            msg = str(e["msg"]).removeprefix("Value error, ")
            reasons.append(f"{where}: {msg}" if where else msg)
        raise ValueError("; ".join(reasons)) from None
