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

OWNER = os.environ.get("SUITE_TEST_OWNER_URL", "postgresql://app_owner:dev@localhost:5433/ttsuite_test")
RW = os.environ.get("SUITE_TEST_DATABASE_URL", "postgresql+psycopg://app_rw:dev@localhost:5433/ttsuite_test")


@pytest.fixture(scope="module")
def engine():
    with psycopg.connect(libpq_url(OWNER), autocommit=True) as c:
        c.execute("DROP SCHEMA IF EXISTS suite CASCADE")
        c.execute("GRANT CONNECT ON DATABASE ttsuite_test TO app_rw")
    assert migrate(OWNER, "app_rw") == ["0001_suite"]
    assert migrate(OWNER, "app_rw") == []  # idempotent
    eng = create_engine(RW)
    yield eng
    eng.dispose()


def _session_for(db: Session, user_id: str) -> str:
    token = new_session_token()
    db.execute(
        text("INSERT INTO suite.session (id, user_id, expires_at) VALUES (:id, :u, :e)"),
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
        db.execute(text("UPDATE suite.users SET status='active' WHERE id=:u"), {"u": uid})
        who = identity.resolve(db, token, "kanban")
        assert who and who.email == "x@tektalis.com" and who.app_role == "lead"
        assert identity.resolve(db, token, "lms").app_role is None  # no LMS access
        # revoke
        identity.mirror_access(db, email="x@tektalis.com", app="kanban", role=None)
        assert identity.resolve(db, token, "kanban").app_role is None
        actions = db.execute(text("SELECT count(*) FROM suite.audit_log WHERE target_id=:u"), {"u": uid}).scalar()
        assert actions == 2
        identity.revoke_sessions(db, uid)
        assert identity.resolve(db, token, "kanban") is None
        db.rollback()


def test_unknown_role_refused(engine):
    with Session(engine) as db, pytest.raises(identity.SuiteAccessError):
        identity.mirror_access(db, email="y@tektalis.com", app="lms", role="lead")
