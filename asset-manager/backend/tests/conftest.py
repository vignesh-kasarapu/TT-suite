"""Tests run against the TT Suite's local Postgres (deploy/docker-compose.yml, port 5433) in their
own database `ams_test`: schema `app` (suite_core) + schema `ams` (AMS Alembic), like production.
AMS_TEST_OWNER_URL / AMS_TEST_DATABASE_URL override the defaults.

Every test starts from empty tables with three people, created through the suite exactly as the
global admin would (POST /internal/provision): Tektalis Admin (ADMIN, id 1), Alex Morgan
(ASSET_MANAGER, id 2) and Jordan Lee (EMPLOYEE, id 3). The *_headers fixtures carry each one's
suite session cookie plus the CSRF header.
"""
import os
from collections.abc import Generator
from datetime import datetime, timedelta, timezone

OWNER = os.environ.get("AMS_TEST_OWNER_URL", "postgresql+psycopg://app_owner:dev@localhost:5433/ams_test")
RW = os.environ.get("AMS_TEST_DATABASE_URL", "postgresql+psycopg://app_rw:dev@localhost:5433/ams_test")
INTERNAL_TOKEN = "test-internal-token"
os.environ.update(DATABASE_URL=RW, DATABASE_OWNER_URL=OWNER, APP_PROFILE="test", INTERNAL_TOKEN=INTERNAL_TOKEN)

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from suite_core.cookies import hash_session_id, new_session_token  # noqa: E402
from suite_core.migrate import libpq_url, migrate, role_of  # noqa: E402
from suite_core.provision import ProvisionRequest  # noqa: E402

import app.common.models_registry  # noqa: E402,F401
from app.common.database import Base, SessionLocal  # noqa: E402
from app.common.migrations import run_migrations  # noqa: E402
from app.common.seed import seed_database  # noqa: E402
from app.main import app  # noqa: E402
from app.suite import service as suite  # noqa: E402

XHR = {"X-Requested-With": "XHR"}
SUITE_TABLES = "app.session, app.app_access, app.user_preference, app.audit_log, app.users"
PEOPLE = [  # (email, name, suite role) - in this order, so the AMS ids are 1, 2, 3
    ("admin@tektalis.com", "Tektalis Admin", "admin"),
    ("manager@tektalis.com", "Alex Morgan", "manager"),
    ("employee@tektalis.com", "Jordan Lee", "employee"),
]


def _create_database() -> None:
    name = OWNER.rsplit("/", 1)[1]
    with psycopg.connect(libpq_url(OWNER.rsplit("/", 1)[0] + "/postgres"), autocommit=True) as c:
        if not c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone():
            c.execute(f'CREATE DATABASE "{name}"')
    with psycopg.connect(libpq_url(OWNER), autocommit=True) as c:
        c.execute(f'GRANT CONNECT ON DATABASE "{name}" TO {role_of(RW)}')


@pytest.fixture(scope="session")
def owner_engine():
    _create_database()
    migrate(OWNER, role_of(RW))  # schema `app`
    run_migrations()  # schema `ams` + grants to the runtime role
    eng = create_engine(OWNER)
    yield eng
    eng.dispose()


@pytest.fixture()
def db_session(owner_engine) -> Generator[Session, None, None]:
    tables = ", ".join(f"ams.{t.name}" for t in Base.metadata.sorted_tables)
    with owner_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables}, {SUITE_TABLES} RESTART IDENTITY CASCADE"))
        conn.execute(text("ALTER SEQUENCE ams.ams_asset_tag_seq RESTART WITH 1"))
    session = SessionLocal()
    try:
        seed_database(session)
        for email, name, role in PEOPLE:
            suite.provision(session, ProvisionRequest(email=email, name=name, role=role, source="global"))
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    with TestClient(app, headers=XHR) as test_client:
        yield test_client


def suite_session(email: str) -> dict[str, str]:
    """A live suite session for `email` (as if they signed in through the portal), as request headers."""
    token = new_session_token()
    with SessionLocal() as db:
        uid = db.execute(text("SELECT id FROM app.users WHERE email = :e"), {"e": email}).scalar_one()
        db.execute(
            text("INSERT INTO app.session (id, user_id, expires_at) VALUES (:id, :u, :e)"),
            {"id": hash_session_id(token), "u": uid, "e": datetime.now(timezone.utc) + timedelta(hours=1)},
        )
        db.execute(text("UPDATE app.users SET status = 'active' WHERE id = :u"), {"u": uid})
        db.commit()
    return {"cookie": f"tt_session={token}", **XHR}


def get_auth_headers(client: TestClient, email: str, _password: str = "") -> dict[str, str]:
    """Kept for the existing tests: signs `email` in through the suite (passwords are gone)."""
    return suite_session(email)


@pytest.fixture()
def admin_headers(client: TestClient) -> dict[str, str]:
    return suite_session("admin@tektalis.com")


@pytest.fixture()
def manager_headers(client: TestClient) -> dict[str, str]:
    return suite_session("manager@tektalis.com")


@pytest.fixture()
def employee_headers(client: TestClient) -> dict[str, str]:
    return suite_session("employee@tektalis.com")
