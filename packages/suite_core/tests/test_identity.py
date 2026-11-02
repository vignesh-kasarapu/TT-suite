"""suite_core against a real Postgres (deploy/docker-compose.yml, port 5433).

SUITE_TEST_OWNER_URL / SUITE_TEST_DATABASE_URL override the defaults.
"""

import os
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from suite_core import identity
from suite_core.cookies import hash_session_id, new_session_token
from suite_core.migrate import libpq_url, migrate

#: Every suite migration, in the order `migrate` applies them. Add the new id when you add
#: a file to suite_core/sql — these tests assert the full sequence, not just the latest.
ALL_MIGRATIONS = [
    "0001_suite",
    "0002_asset_manager",
    "0003_inbox_requests_sessions",
    "0004_profile_details",
    "0005_profile_owned_fields",
    "0006_resume_app",
    "0007_employee_code",
    "0008_personal_details",
]

OWNER = os.environ.get("SUITE_TEST_OWNER_URL", "postgresql://app_owner:dev@localhost:5433/ttsuite_test")
RW = os.environ.get("SUITE_TEST_DATABASE_URL", "postgresql+psycopg://app_rw:dev@localhost:5433/ttsuite_test")


@pytest.fixture(scope="module")
def engine():
    with psycopg.connect(libpq_url(OWNER), autocommit=True) as c:
        c.execute("DROP SCHEMA IF EXISTS suite CASCADE")  # the name before `app`
        c.execute("DROP SCHEMA IF EXISTS app CASCADE")
        c.execute("GRANT CONNECT ON DATABASE ttsuite_test TO app_rw")
    assert migrate(OWNER, "app_rw") == ALL_MIGRATIONS
    assert migrate(OWNER, "app_rw") == []  # idempotent
    eng = create_engine(RW)
    yield eng
    eng.dispose()


def _session_for(db: Session, user_id: str) -> str:
    token = new_session_token()
    db.execute(
        text("INSERT INTO app.session (id, user_id, expires_at) VALUES (:id, :u, :e)"),
        {"id": hash_session_id(token), "u": user_id, "e": datetime.now(UTC) + timedelta(hours=1)},
    )
    return token


def test_mirror_creates_person_and_access_then_resolve(engine):
    with Session(engine) as db:
        uid = identity.mirror_access(db, email="X@Tektalis.com", name="X", app="kanban", role="lead")
        assert identity.access_of(db, uid, "kanban") == "lead"
        # invited people cannot hold a session yet
        token = _session_for(db, uid)
        assert identity.resolve(db, token, "kanban") is None
        db.execute(text("UPDATE app.users SET status='active' WHERE id=:u"), {"u": uid})
        who = identity.resolve(db, token, "kanban")
        assert who and who.email == "x@tektalis.com" and who.app_role == "lead"
        assert identity.resolve(db, token, "lms").app_role is None  # no LMS access
        # revoke
        identity.mirror_access(db, email="x@tektalis.com", app="kanban", role=None)
        assert identity.resolve(db, token, "kanban").app_role is None
        actions = db.execute(text("SELECT count(*) FROM app.audit_log WHERE target_id=:u"), {"u": uid}).scalar()
        assert actions == 2
        identity.revoke_sessions(db, uid)
        assert identity.resolve(db, token, "kanban") is None
        db.rollback()


def test_unknown_role_refused(engine):
    with Session(engine) as db, pytest.raises(identity.SuiteAccessError):
        identity.mirror_access(db, email="y@tektalis.com", app="lms", role="lead")


def test_a_database_with_the_old_suite_schema_is_renamed_to_app() -> None:
    with psycopg.connect(libpq_url(OWNER), autocommit=True) as c:
        c.execute("DROP SCHEMA IF EXISTS suite CASCADE")
        c.execute("DROP SCHEMA IF EXISTS app CASCADE")
    assert migrate(OWNER, "app_rw") == ALL_MIGRATIONS
    with psycopg.connect(libpq_url(OWNER), autocommit=True) as c:
        c.execute("ALTER SCHEMA app RENAME TO suite")  # the layout before the rename
        c.execute("INSERT INTO suite.users (id, email) VALUES ('U1', 'old@tektalis.com')")
    assert migrate(OWNER, "app_rw") == []  # renamed, nothing re-run
    with psycopg.connect(libpq_url(OWNER), autocommit=True) as c:
        names = [r[0] for r in c.execute("SELECT nspname FROM pg_namespace WHERE nspname IN ('suite', 'app')")]
        assert names == ["app"]
        assert c.execute("SELECT email FROM app.users WHERE id = 'U1'").fetchone() == ("old@tektalis.com",)
    with psycopg.connect(libpq_url(RW)) as c:  # the runtime role keeps its rights
        assert c.execute("SELECT count(*) FROM app.users").fetchone()[0] >= 1
