from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from sqlalchemy import text


def suite_access(db_session: Session, email: str) -> tuple[str, str] | None:
    """(role, source) of `email` for app "ams" in the TT Suite, or None."""
    db_session.expire_all()
    row = db_session.execute(text(
        "SELECT a.role, a.source FROM app.app_access a JOIN app.users u ON u.id = a.user_id"
        " WHERE u.email = :e AND a.app = 'ams'"), {"e": email}).first()
    return (row[0], row[1]) if row else None
from app.users.models import User
from tests.test_schema_and_seed import assert_error_contract


def test_list_users_pagination_search_and_filters(
    client: TestClient,
    admin_headers: dict[str, str],
) -> None:
    # Default list
    resp = client.get("/api/v1/users?page=1&size=20&sort=name,asc", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert body["page"] == 1
    assert body["size"] == 20
    assert body["pages"] == 1
    names = [u["name"] for u in body["items"]]
    assert names == sorted(names)

    # Filter by role
    role_resp = client.get("/api/v1/users?role=ASSET_MANAGER", headers=admin_headers)
    assert role_resp.status_code == 200
    assert role_resp.json()["total"] == 1
    assert role_resp.json()["items"][0]["email"] == "manager@tektalis.com"

    # Search by email/name
    search_resp = client.get("/api/v1/users?search=jordan", headers=admin_headers)
    assert search_resp.status_code == 200
    assert search_resp.json()["total"] == 1
    assert search_resp.json()["items"][0]["email"] == "employee@tektalis.com"


def test_ams_no_longer_creates_imports_or_edits_users(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    """TT Suite: only the global admin (portal) creates people, assigns roles, changes emails and
    deactivates. AMS's own create / import / template / edit routes are gone."""
    employee = db_session.scalar(select(User).where(User.email == "employee@tektalis.com"))
    assert employee is not None

    gone = [
        client.post("/api/v1/users", headers=admin_headers,
                    json={"name": "Priya Nair", "email": "priya.nair@tektalis.com", "role": "ASSET_MANAGER"}),
        client.get("/api/v1/users/import/template", headers=admin_headers),
        client.post("/api/v1/users/import", headers=admin_headers,
                    json={"csv_content": "name,email\nA,a@tektalis.com\n"}),
        client.put(f"/api/v1/users/{employee.id}", headers=admin_headers,
                   json={"role": "ADMIN", "active": False, "email": "x@tektalis.com"}),
        client.patch(f"/api/v1/users/{employee.id}", headers=admin_headers, json={"active": False}),
    ]
    for resp in gone:
        assert resp.status_code in (404, 405), resp.text

    db_session.expire_all()
    assert db_session.scalar(select(User).where(User.email == "priya.nair@tektalis.com")) is None
    employee = db_session.scalar(select(User).where(User.email == "employee@tektalis.com"))
    assert employee.role.value == "EMPLOYEE" and employee.active is True
    assert suite_access(db_session, "employee@tektalis.com") == ("employee", "global")


def _make_global_admin(db_session: Session, email: str = "global.admin@tektalis.com") -> str:
    from suite_core.ulid import ulid

    uid = ulid()
    db_session.execute(text(
        "INSERT INTO app.users (id, email, name, status, is_global_admin)"
        " VALUES (:id, :e, 'Global Admin', 'active', true)"), {"id": uid, "e": email})
    db_session.commit()
    return uid


def test_role_request_records_a_pending_request_and_messages_the_global_admins(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session: Session,
) -> None:
    global_admin = _make_global_admin(db_session)
    employee = db_session.scalar(select(User).where(User.email == "employee@tektalis.com"))
    assert employee is not None

    resp = client.post(f"/api/v1/users/{employee.id}/role-request", headers=admin_headers,
                       json={"role": "manager", "note": "Runs the Pune store room now"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["role"] == "manager" and body["message"] == "Sent to the global admin for approval."

    db_session.expire_all()
    row = db_session.execute(text(
        "SELECT r.role, r.status, r.note, b.email FROM app.role_request r"
        " JOIN app.users u ON u.id = r.user_id LEFT JOIN app.users b ON b.id = r.requested_by"
        " WHERE r.app = 'ams' AND u.email = 'employee@tektalis.com'")).one()
    assert tuple(row) == ("manager", "pending", "Runs the Pune store room now", "admin@tektalis.com")

    messages = db_session.execute(text(
        "SELECT kind, title FROM app.message WHERE user_id = :u"), {"u": global_admin}).all()
    assert len(messages) == 1
    assert messages[0][0] == "role_request" and "Jordan Lee" in messages[0][1] and "Manager" in messages[0][1]

    # Nothing changed yet: the global admin decides.
    assert suite_access(db_session, "employee@tektalis.com") == ("employee", "global")
    assert employee.role.value == "EMPLOYEE"

    pending = client.get("/api/v1/users/role-requests", headers=admin_headers)
    assert pending.status_code == 200
    assert [(p["email"], p["role"]) for p in pending.json()] == [("employee@tektalis.com", "manager")]

    # A newer request replaces the open one; null asks to remove the access.
    again = client.post(f"/api/v1/users/{employee.id}/role-request", headers=admin_headers, json={"role": None})
    assert again.status_code == 200
    pending = client.get("/api/v1/users/role-requests", headers=admin_headers).json()
    assert [(p["email"], p["role"]) for p in pending] == [("employee@tektalis.com", None)]


def test_role_request_rejects_unknown_roles_and_non_admins(
    client: TestClient,
    admin_headers: dict[str, str],
    manager_headers: dict[str, str],
    employee_headers: dict[str, str],
    db_session: Session,
) -> None:
    employee = db_session.scalar(select(User).where(User.email == "employee@tektalis.com"))
    assert employee is not None

    bad = client.post(f"/api/v1/users/{employee.id}/role-request", headers=admin_headers, json={"role": "lead"})
    assert bad.status_code == 422
    assert_error_contract(bad.json(), 422)
    assert bad.json()["code"] == "UNKNOWN_ROLE"

    missing = client.post("/api/v1/users/999999/role-request", headers=admin_headers, json={"role": "admin"})
    assert missing.status_code == 404
    assert_error_contract(missing.json(), 404)

    for headers in (manager_headers, employee_headers):
        resp = client.post(f"/api/v1/users/{employee.id}/role-request", headers=headers, json={"role": "admin"})
        assert resp.status_code == 403
        assert_error_contract(resp.json(), 403)
        assert client.get("/api/v1/users/role-requests", headers=headers).status_code == 403
    assert client.post(f"/api/v1/users/{employee.id}/role-request", json={"role": "admin"}).status_code == 401

    db_session.expire_all()
    assert db_session.execute(text("SELECT count(*) FROM app.role_request")).scalar_one() == 0
