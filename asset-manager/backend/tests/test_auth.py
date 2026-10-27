"""Sign-in through the TT Suite: AMS reads the portal's session cookie on every request."""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import text
from suite_core import identity
from suite_core.cookies import hash_session_id, new_session_token

from app.common.database import SessionLocal
from tests.conftest import INTERNAL_TOKEN, XHR, suite_session
from tests.test_schema_and_seed import assert_error_contract


def _session_cookie(email: str, *, hours: float) -> dict[str, str]:
    token = new_session_token()
    with SessionLocal() as db:
        uid = db.execute(text("SELECT id FROM app.users WHERE email = :e"), {"e": email}).scalar_one()
        db.execute(text("INSERT INTO app.session (id, user_id, expires_at) VALUES (:id, :u, :e)"),
                   {"id": hash_session_id(token), "u": uid, "e": datetime.now(timezone.utc) + timedelta(hours=hours)})
        db.commit()
    return {"cookie": f"tt_session={token}", **XHR}


def test_me_needs_a_live_suite_session(client: TestClient, admin_headers: dict[str, str]) -> None:
    me = client.get("/api/v1/auth/me", headers=admin_headers)
    assert me.status_code == 200
    assert me.json()["email"] == "admin@tektalis.com" and me.json()["role"] == "ADMIN"

    for headers in ({}, {"cookie": "tt_session=not-a-real-session"}):
        resp = client.get("/api/v1/auth/me", headers=headers)
        assert resp.status_code == 401
        assert_error_contract(resp.json(), 401)
        assert resp.json()["code"] == "UNAUTHENTICATED"


def test_an_expired_session_is_refused(client: TestClient) -> None:
    suite_session("admin@tektalis.com")  # activates the person
    resp = client.get("/api/v1/auth/me", headers=_session_cookie("admin@tektalis.com", hours=-1))
    assert resp.status_code == 401


def test_a_suite_person_without_ams_access_gets_no_app_access(client: TestClient) -> None:
    with SessionLocal() as db:  # someone the suite knows, with access to another app only
        identity.mirror_access(db, email="lms.only@tektalis.com", name="LMS Only", app="lms", role="employee")
        db.commit()
    resp = client.get("/api/v1/auth/me", headers=suite_session("lms.only@tektalis.com"))
    assert resp.status_code == 403
    assert resp.json()["code"] == "NO_APP_ACCESS"


def test_the_global_admin_revoking_someone_removes_their_ams_access(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    assert client.get("/api/v1/auth/me", headers=employee_headers).status_code == 200
    resp = client.post("/internal/provision", headers={"x-internal-token": INTERNAL_TOKEN},
                       json={"email": "employee@tektalis.com", "role": None})
    assert resp.status_code == 200 and resp.json()["role"] is None

    # Their suite session still exists (other apps keep working), but AMS refuses them at once.
    blocked = client.get("/api/v1/auth/me", headers=employee_headers)
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "NO_APP_ACCESS"
    with SessionLocal() as db:
        row = db.execute(text(
            "SELECT count(*) FROM app.app_access a JOIN app.users u ON u.id = a.user_id"
            " WHERE u.email = 'employee@tektalis.com' AND a.app = 'ams'"
        )).scalar_one()
    assert row == 0


def test_role_protection_blocks_non_admin_from_user_endpoints(
    client: TestClient, manager_headers: dict[str, str], employee_headers: dict[str, str]
) -> None:
    for headers in (manager_headers, employee_headers):
        list_resp = client.get("/api/v1/users", headers=headers)
        assert list_resp.status_code == 403
        assert_error_contract(list_resp.json(), 403)

        request_resp = client.post("/api/v1/users/1/role-request", headers=headers, json={"role": "employee"})
        assert request_resp.status_code == 403
        assert_error_contract(request_resp.json(), 403)


def test_profile_editing_is_the_portals_and_the_name_follows_the_suite(
    client: TestClient, employee_headers: dict[str, str]
) -> None:
    resp = client.put("/api/v1/auth/me", headers=employee_headers, json={"name": "Jordan Lee-Smith"})
    assert resp.status_code == 405

    # The person renames themselves in the portal profile: AMS picks it up on the next request.
    with SessionLocal() as db:
        db.execute(text("UPDATE app.users SET name = 'Jordan Lee-Smith' WHERE email = 'employee@tektalis.com'"))
        db.commit()
    me = client.get("/api/v1/auth/me", headers=employee_headers)
    assert me.status_code == 200 and me.json()["name"] == "Jordan Lee-Smith"
    with SessionLocal() as db:
        local = db.execute(text("SELECT name FROM ams.ams_users WHERE email = 'employee@tektalis.com'")).scalar_one()
    assert local == "Jordan Lee-Smith"

    # An empty suite name never blanks the local one.
    with SessionLocal() as db:
        db.execute(text("UPDATE app.users SET name = '' WHERE email = 'employee@tektalis.com'"))
        db.commit()
    assert client.get("/api/v1/auth/me", headers=employee_headers).json()["name"] == "Jordan Lee-Smith"


def test_login_and_password_routes_are_gone(client: TestClient, employee_headers: dict[str, str]) -> None:
    assert client.post("/api/v1/auth/login", json={"email": "admin@tektalis.com", "password": "Admin@123"}).status_code in (404, 405)
    resp = client.post("/api/v1/auth/change-password", headers=employee_headers,
                       json={"current_password": "x", "new_password": "yyyyyy"})
    assert resp.status_code in (404, 405)


def test_writes_need_the_csrf_header(client: TestClient, admin_headers: dict[str, str]) -> None:
    cookie_only = {"cookie": admin_headers["cookie"], "X-Requested-With": ""}
    resp = client.post("/api/v1/users/3/role-request", headers=cookie_only, json={"role": "admin"})
    assert resp.status_code == 403
    assert resp.json()["code"] == "CSRF_HEADER_MISSING"
