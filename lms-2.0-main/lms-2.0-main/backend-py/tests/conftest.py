"""Test fixtures. Runs against a dedicated PostgreSQL database (default `lms_test` on the
suite's local Postgres, deploy/docker-compose.yml, port 5433):

- created on first use by the owner role (app_owner has CREATEDB);
- the `suite` schema is migrated there with suite_core.migrate (as the portal would);
- schema `lms` is dropped and rebuilt every session (Alembic head + grants + reference
  seed, exactly what app.core.bootstrap_db does at boot) and the suite tables are
  emptied, so every run starts from the same clean state;
- the app itself connects as the runtime role (app_rw), like production.

Override with LMS_TEST_OWNER_URL / LMS_TEST_DATABASE_URL (same database, two roles).
Web requests authenticate the suite way: `sign_in(client, employee)` calls the
dev/test-only POST /api/auth/dev/sign-in, which opens a real app.session row and sets
the `tt_session` cookie on the TestClient.
"""
import os
import tempfile
from datetime import date
from urllib.parse import urlsplit, urlunsplit

OWNER_URL = os.environ.get("LMS_TEST_OWNER_URL", "postgresql://app_owner:dev@localhost:5433/lms_test")
RUNTIME_URL = os.environ.get("LMS_TEST_DATABASE_URL", "postgresql://app_rw:dev@localhost:5433/lms_test")
INTERNAL_TOKEN = "test-internal-token"

# Settings are read at import time, so the environment is pinned before any app import.
os.environ.update(
    {
        "APP_PROFILE": "test",
        "DATABASE_URL": RUNTIME_URL,
        "DATABASE_OWNER_URL": OWNER_URL,
        "INTERNAL_TOKEN": INTERNAL_TOKEN,
        "SCHEDULER_ENABLED": "false",
        "DEV_AUTH_BYPASS_ENABLED": "false",
        "MAIL_HOST": "",  # never send real mail from tests (backend-py/.env may set one)
        "STORAGE_DIR": tempfile.mkdtemp(prefix="lms-test-storage-"),
    }
)

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from suite_core.migrate import migrate as migrate_suite, role_of  # noqa: E402

from app.core.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models.employee import Employee  # noqa: E402
from app.models.org_structure import Role  # noqa: E402
from app.services import role_assignment_service  # noqa: E402

TEST_EMPLOYEE_CODE = "TEST001"


def _ensure_database() -> None:
    parts = urlsplit(OWNER_URL)
    name = parts.path.lstrip("/")
    maintenance = urlunsplit(parts._replace(path="/postgres"))
    with psycopg.connect(maintenance, autocommit=True) as conn:
        if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone() is None:
            conn.execute(f'CREATE DATABASE "{name}"')


def _reset_schemas() -> None:
    with psycopg.connect(OWNER_URL, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS lms CASCADE")
        conn.execute(
            "TRUNCATE app.users, app.audit_log, app.mail_outbox RESTART IDENTITY CASCADE"
        )


@pytest.fixture(scope="session", autouse=True)
def _database():
    from app.core.bootstrap_db import bootstrap

    _ensure_database()
    migrate_suite(OWNER_URL, role_of(RUNTIME_URL))
    _reset_schemas()
    bootstrap()  # schema lms + Alembic head + grants + reference seed
    _seed_company_policy()  # the example policy: company leave types + the Sick/Casual pool
    yield


def _seed_company_policy() -> None:
    """Tests need a company's leave types to exist. Production gets them from a deployment's
    own seed/company-policy.json; here the tracked example stands in, so the suite runs
    against the same shape a real deployment has."""
    import json
    from pathlib import Path

    from scripts.seed_company_policy import apply_policy

    policy = json.loads(
        (Path(__file__).resolve().parents[1] / "seed" / "company-policy.example.json").read_text(encoding="utf-8")
    )
    session = SessionLocal()
    try:
        apply_policy(session, policy, actor_id=None, dry_run=False)
    finally:
        session.close()


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def annual_type_id(db=None) -> int:
    """The Annual Leave type's id. Leave-type ids depend on seeding order — the reference
    seed creates the system types (LOP, Comp-Off) and the company policy creates the rest —
    so a test must never assume 1. Opens its own session when a test has no `db` fixture.
    """
    from app.dao import leave_type_dao

    if db is not None:
        return leave_type_dao.find_by_code(db, "ANNUAL").leave_type_id
    session = SessionLocal()
    try:
        return leave_type_dao.find_by_code(session, "ANNUAL").leave_type_id
    finally:
        session.close()


def sign_in(client: TestClient, employee: Employee) -> TestClient:
    """Signs `client` into the suite as `employee` (replaces the old dev bypass)."""
    client.cookies.clear()
    res = client.post("/api/auth/dev/sign-in", json={"employeeCode": employee.employee_code})
    assert res.status_code == 200, res.text
    return client


@pytest.fixture()
def test_employee(db):
    employee = db.query(Employee).filter_by(employee_code=TEST_EMPLOYEE_CODE).first()
    if employee is None:
        employee = Employee(
            work_email="test001@example.com",
            employee_code=TEST_EMPLOYEE_CODE,
            first_name="Auth",
            last_name="Tester",
            date_of_joining=date(2024, 1, 1),
            designation="Test Employee",
            is_active=True,
        )
        db.add(employee)
        db.commit()
        db.refresh(employee)
    return employee


@pytest.fixture()
def client():
    # Every suite frontend sends X-Requested-With on state-changing calls (CSRF check
    # in app/core/deps.py); the test client does the same by default.
    return TestClient(app, headers={"X-Requested-With": "XHR"})


def _ensure_role(db, code, name):
    role = db.query(Role).filter_by(role_code=code).first()
    if role is None:
        role = Role(role_code=code, role_name=name)
        db.add(role)
        db.commit()
        db.refresh(role)
    return role


@pytest.fixture()
def hr_admin(db):
    """Shared across test_employees.py and test_admin.py — every admin-surface
    endpoint is HR_ADMIN-only, so both need the same authenticated actor."""
    _ensure_role(db, "EMPLOYEE", "Employee")
    _ensure_role(db, "HR_ADMIN", "HR Admin")
    employee = db.query(Employee).filter_by(employee_code="TESTHR").first()
    if employee is None:
        employee = Employee(
            work_email="testhr@example.com", employee_code="TESTHR", first_name="HR", last_name="Admin",
            date_of_joining=date(2024, 1, 1), designation="HR Admin", is_active=True,
        )
        db.add(employee)
        db.commit()
        db.refresh(employee)
    role_assignment_service.assign_role(db, employee.employee_id, "HR_ADMIN", employee.employee_id)
    return employee


@pytest.fixture()
def as_hr_admin(client, hr_admin):
    return sign_in(client, hr_admin)


def provision_employee(client: TestClient, *, email: str | None = None, name: str = "New Person",
                       role: str = "employee") -> int:
    """Creates (or updates) an employee the only way people now arrive in LMS: the portal's
    POST /internal/provision (onboarding with defaults). Returns the local employee id."""
    import uuid

    email = email or f"prov.{uuid.uuid4().hex[:10]}@example.com"
    res = client.post(
        "/internal/provision", headers={"x-internal-token": INTERNAL_TOKEN},
        json={"email": email, "name": name, "role": role, "source": "global",
              "employee_code": "P" + uuid.uuid5(uuid.NAMESPACE_DNS, email).hex[:10].upper()},
    )
    assert res.status_code == 200, res.text
    return int(res.json()["local_user_id"])
