"""Tests run against the TT Suite's local Postgres (TT-suite/deploy/docker-compose.yml, port 5433) in their own
database `ems_test`: schema `app` (suite_core migrations) + schema `expense` (EMS Alembic), like production.
TEST_DATABASE_OWNER_URL / TEST_DATABASE_URL override the defaults."""
import os

import psycopg

OWNER = os.environ.get("TEST_DATABASE_OWNER_URL", "postgresql+psycopg://app_owner:dev@localhost:5433/ems_test")
RW = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://app_rw:dev@localhost:5433/ems_test")
INTERNAL_TOKEN = "test-internal-token"
os.environ.update(DATABASE_URL=RW, DATABASE_OWNER_URL=OWNER, APP_PROFILE="test", INTERNAL_TOKEN=INTERNAL_TOKEN)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from suite_core.migrate import libpq_url, migrate, role_of  # noqa: E402

from app.core.db import Base  # noqa: E402
from app.core.migrations import run_migrations  # noqa: E402
from app.main import app  # noqa: E402

XHR = {"X-Requested-With": "XHR"}
SUITE_TABLES = "app.session, app.app_access, app.user_preference, app.audit_log, app.users"


def _create_database() -> None:
    db_name = OWNER.rsplit("/", 1)[1]
    admin_url = libpq_url(OWNER.rsplit("/", 1)[0] + "/postgres")
    with psycopg.connect(admin_url, autocommit=True) as c:
        if not c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,)).fetchone():
            c.execute(f'CREATE DATABASE "{db_name}"')
    with psycopg.connect(libpq_url(OWNER), autocommit=True) as c:
        c.execute(f'GRANT CONNECT ON DATABASE "{db_name}" TO {role_of(RW)}')


@pytest.fixture(scope="session")
def owner_engine():
    _create_database()
    migrate(OWNER, role_of(RW))  # schema `suite`
    run_migrations()  # schema `expense` + grants to the runtime role
    eng = create_engine(OWNER)
    yield eng
    eng.dispose()


@pytest.fixture(autouse=True)
def fresh_data(owner_engine):
    tables = ", ".join(f"expense.{t.name}" for t in Base.metadata.sorted_tables)
    with owner_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables}, {SUITE_TABLES} RESTART IDENTITY CASCADE"))
    import seed
    seed.main()


class Api:
    """Signs in as a seeded user (dev sign-in -> suite session cookie) and wraps the calls tests make."""

    def __init__(self, email: str):
        self.client = TestClient(app, headers=XHR)
        r = self.client.post("/api/auth/dev/sign-in", json={"email": email})
        assert r.status_code == 200, r.text
        assert self.client.cookies.get("tt_session")
        self.user = r.json()

    def get(self, url, **kw):
        return self.client.get(url, **kw)

    def post(self, url, json=None, **kw):
        return self.client.post(url, json=json, **kw)

    def ok(self, method, url, json=None):
        r = self.client.request(method.upper(), url, json=json)
        assert r.status_code < 300, f"{method} {url} -> {r.status_code} {r.text}"
        return r.json() if r.content else None

    def receipt(self, content: bytes = b"receipt") -> dict:
        r = self.client.post("/api/claims/receipts", files={"file": ("r.pdf", content, "application/pdf")})
        assert r.status_code == 200, r.text
        return r.json()

    def category(self, name: str) -> int:
        return next(c["id"] for c in self.ok("get", "/api/lookups/categories") if c["name"] == name)

    def line(self, category: str, amount, **extra) -> dict:
        import uuid
        base = {"category_id": self.category(category), "expense_date": "2026-10-01", "amount": amount,
                "merchant": f"Shop {uuid.uuid4().hex[:6]}", **self.receipt(uuid.uuid4().bytes)}
        base["extra_field_value"] = "Team"
        return {**base, **extra}

    def submit(self, lines: list[dict], title="Test claim") -> dict:
        return self.ok("post", "/api/claims", {"title": title, "lines": lines})

    def inbox(self) -> list[dict]:
        return self.ok("get", "/api/approvals/inbox")

    def step_for(self, claim_id: int) -> list[dict]:
        return [i for i in self.inbox() if i["claim_id"] == claim_id]


@pytest.fixture
def as_user():
    return lambda key: Api(f"{key}@example.com")
