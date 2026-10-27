"""Sliding sessions (24 h idle, 30 days at most) and role requests with their inbox messages."""

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from suite_core import identity, inbox
from suite_core.cookies import hash_session_id, new_session_token
from suite_core.identity import SuiteAccessError, session_expiry
from suite_core.migrate import migrate

OWNER = os.environ.get("SUITE_TEST_OWNER_URL", "postgresql://app_owner:dev@localhost:5433/ttsuite_test")
RW = os.environ.get("SUITE_TEST_DATABASE_URL", "postgresql+psycopg://app_rw:dev@localhost:5433/ttsuite_test")


@pytest.fixture(scope="module")
def engine():
    migrate(OWNER, "app_rw")
    eng = create_engine(RW)
    yield eng
    eng.dispose()


def _person(db: Session, email: str, *, admin: bool = False) -> str:
    uid = identity.mirror_access(db, email=email, name=email.split("@")[0].title(), app="lms", role="employee")
    db.execute(text("UPDATE app.users SET status = 'active', is_global_admin = :a WHERE id = :u"), {"a": admin, "u": uid})
    return uid


def _session(db: Session, uid: str, *, created: datetime, expires: datetime) -> str:
    token = new_session_token()
    db.execute(
        text("INSERT INTO app.session (id, user_id, created_at, expires_at) VALUES (:id, :u, :c, :e)"),
        {"id": hash_session_id(token), "u": uid, "c": created, "e": expires},
    )
    return token


def _expires(engine, token: str) -> datetime:
    with engine.connect() as c:
        return c.execute(text("SELECT expires_at FROM app.session WHERE id = :id"), {"id": hash_session_id(token)}).scalar_one()


def test_expiry_is_the_idle_window_capped_by_the_maximum() -> None:
    now = datetime(2026, 10, 27, 12, tzinfo=UTC)
    assert session_expiry(now, now) == now + timedelta(hours=24)
    old = now - timedelta(days=29, hours=12)
    assert session_expiry(old, now) == old + timedelta(days=30)  # 12 h left of the 30 days


def test_using_a_session_slides_its_end_and_an_idle_one_ends(engine) -> None:
    now = datetime.now(UTC)
    with Session(engine) as db:
        uid = _person(db, "slide@tektalis.com")
        active = _session(db, uid, created=now - timedelta(hours=30), expires=now + timedelta(hours=2))
        idle = _session(db, uid, created=now - timedelta(hours=30), expires=now - timedelta(minutes=1))
        db.commit()
    with Session(engine) as db:  # a read-only request: nothing is committed by the caller
        assert identity.resolve(db, active, "lms") is not None
        assert identity.resolve(db, idle, "lms") is None
    assert _expires(engine, active) > now + timedelta(hours=23)  # 24 h from now, not 2 h
    with Session(engine) as db:  # used again within 5 minutes: no second write
        before = _expires(engine, active)
        identity.resolve(db, active, "lms")
    assert _expires(engine, active) == before


def test_a_session_never_outlives_thirty_days(engine) -> None:
    now = datetime.now(UTC)
    with Session(engine) as db:
        uid = _person(db, "old@tektalis.com")
        token = _session(db, uid, created=now - timedelta(days=29, hours=23), expires=now + timedelta(minutes=10))
        db.commit()
    with Session(engine) as db:
        assert identity.resolve(db, token, "lms") is not None
    assert _expires(engine, token) <= now - timedelta(days=29, hours=23) + timedelta(days=30, seconds=1)


def test_a_role_request_reaches_every_global_admin_and_replaces_an_open_one(engine) -> None:
    with Session(engine) as db:
        admin_a = _person(db, "ga1@tektalis.com", admin=True)
        admin_b = _person(db, "ga2@tektalis.com", admin=True)
        asker = _person(db, "lmsadmin@tektalis.com")
        _person(db, "target@tektalis.com")
        first = inbox.request_role_change(db, app="lms", email="target@tektalis.com", role="manager", requested_by=asker,
                                          note="leads the Hyderabad team")
        second = inbox.request_role_change(db, app="lms", email="target@tektalis.com", role="admin", requested_by=asker)
        db.commit()
        statuses = dict(db.execute(text("SELECT id, status FROM app.role_request WHERE id IN (:a, :b)"),
                                   {"a": first, "b": second}).all())
        assert statuses == {first: "cancelled", second: "pending"}
        for admin in (admin_a, admin_b):
            titles = [r[0] for r in db.execute(text("SELECT title FROM app.message WHERE user_id = :u"), {"u": admin})]
            assert any("Target → Admin in Leave (LMS)" in t for t in titles)
        assert [p["role"] for p in inbox.pending_requests(db, "lms") if p["email"] == "target@tektalis.com"] == ["admin"]

        with pytest.raises(SuiteAccessError):
            inbox.request_role_change(db, app="lms", email="target@tektalis.com", role="lead", requested_by=asker)
        with pytest.raises(SuiteAccessError):
            inbox.request_role_change(db, app="lms", email="nobody@tektalis.com", role="employee", requested_by=asker)
