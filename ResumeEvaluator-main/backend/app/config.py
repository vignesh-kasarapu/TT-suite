import logging
import os
from typing import List
from urllib.parse import urlsplit, urlunsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings

SCHEMA = "resume"  # every table lives here in the suite database; the suite's own tables are app.*
APP = "resume"  # this app's name in the TT Suite (app.app_access.app)
# Under the suite (deploy/run.py sets SUITE_ENV_ONLY) every value comes from the one TT-suite/.env;
# a local .env is read only when the app runs on its own.
ENV_FILE = None if os.environ.get("SUITE_ENV_ONLY") else ".env"


def sqlalchemy_url(url: str) -> str:
    """postgres:// | postgresql:// | postgresql+psycopg2:// -> postgresql+psycopg:// (psycopg 3)."""
    parts = urlsplit(url)
    if parts.scheme.split("+")[0] in ("postgres", "postgresql"):
        parts = parts._replace(scheme="postgresql+psycopg")
    return urlunsplit(parts)


class Settings(BaseSettings):
    # SQLite is for running the app on its own; in the TT Suite this is the shared PostgreSQL
    # (runtime role) and DATABASE_OWNER_URL the owner role that runs the migrations.
    database_url: str = "sqlite:///./resume_eval.db"
    database_owner_url: str = ""
    # Signs share links. deploy/run.py derives it from the suite's APP_SECRET.
    secret_key: str = "change-me-in-production"

    # TT Suite: sign-in is the portal's (no logins here); the portal calls /internal/* with this token.
    app_profile: str = "dev"  # dev | test | prod
    internal_token: str = ""
    host: str = "127.0.0.1"
    port: int = 8006

    cosine_match_threshold: float = 0.70
    cosine_strong_threshold: float = 0.85
    simhash_duplicate_threshold: int = 3

    default_weight_projects: int = 50
    default_weight_skills: int = 30
    default_weight_education: int = 20

    embedding_model: str = "all-MiniLM-L6-v2"
    upload_dir: str = "./uploads"
    max_upload_mb: int = 20

    # CORS — comma-separated list of allowed origins (e.g. "https://app.example.com")
    # Defaults to localhost dev origins; override in production.
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"

    # SMTP outbound email
    smtp_server: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    app_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"

    # IMAP email ingestion (leave imap_host blank to disable)
    imap_host: str = ""
    imap_port: int = 993
    imap_username: str = ""
    imap_password: str = ""
    imap_ssl: bool = True
    imap_poll_interval: int = 60
    # Folder to monitor — use "INBOX" for the main inbox or a sub-folder like "Applications"
    imap_folder: str = "INBOX"
    # Comma-separated subject keywords; only emails whose subject contains at least one
    # keyword will be processed.  Leave empty ("") to accept all emails (no filter).
    imap_subject_keywords: str = "resume,cv,application,applying,job application,position,candidate"

    # GitHub API token — optional but recommended; raises rate limit from 60 to 5000 req/hr
    github_token: str = ""

    # GDPR — privacy policy version stamped onto Candidate.consent_version at
    # intake time. Bump this string whenever the privacy policy changes.
    privacy_policy_version: str = "2026-01"

    # LLM integration
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"
    llm_timeout: int = 30

    # Rate limiting — comma-separated IPs that bypass per-route strict limits.
    # Loopback addresses are included by default so that local QA / dev runs
    # are never blocked.  In production this should remain empty or unset.
    rate_limit_bypass_ips: str = "127.0.0.1,::1,::ffff:127.0.0.1"

    # Logging
    log_level: str = "INFO"

    class Config:
        env_file = ENV_FILE
        env_file_encoding = "utf-8"
        extra = "ignore"

    @field_validator("secret_key")
    @classmethod
    def secret_key_must_not_be_default(cls, v: str) -> str:
        if v == "change-me-in-production":
            raise ValueError(
                "SECRET_KEY is set to the insecure default. "
                "Set SECRET_KEY env var to a random 32+ character string before deploying."
            )
        if len(v) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters long.")
        return v

    @property
    def is_postgres(self) -> bool:
        return urlsplit(self.database_url).scheme.split("+")[0] in ("postgres", "postgresql")

    @property
    def db_url(self) -> str:
        return sqlalchemy_url(self.database_url)

    @property
    def owner_db_url(self) -> str:
        return sqlalchemy_url(self.database_owner_url or self.database_url)

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def rate_limit_bypass_ips_set(self) -> set:
        """Return the set of IPs that bypass per-route rate limits."""
        return {ip.strip() for ip in self.rate_limit_bypass_ips.split(",") if ip.strip()}

    def validate_production(self) -> None:
        """Log warnings for missing or insecure production configuration."""
        logger = logging.getLogger(__name__)
        if not self.is_postgres:
            logger.warning(
                "DATABASE_URL is SQLite — not suitable for production. "
                "SQLite cannot handle concurrent writes; use PostgreSQL. "
                "Set DATABASE_URL=postgresql://user:pass@host:5432/dbname"
            )
        if self.secret_key == "change-me-in-production" or len(self.secret_key) < 32:
            logger.error("SECRET_KEY is insecure. Set SECRET_KEY env var before deploying.")
        if self.max_upload_mb <= 0:
            raise ValueError(f"MAX_UPLOAD_MB must be positive, got {self.max_upload_mb}")


settings = Settings()
