"""The portal -> AMS contract (SUITE-CONTRACT 3.2): provision and authorize, plus the boot link."""
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.suite import service as suite
from app.users.models import User
from tests.conftest import INTERNAL_TOKEN, suite_session

TOKEN = {"x-internal-token": INTERNAL_TOKEN}


def access(db: Session, email: str) -> tuple[str, str] | None:
    db.expire_all()
    row = db.execute(text(
        "SELECT a.role, a.source FROM app.app_access a JOIN app.users u ON u.id = a.user_id"
        " WHERE u.email = :e AND a.app = 'ams'"), {"e": email}).first()
    return (row[0], row[1]) if row else None


def local(db: Session, email: str) -> User | None:
    db.expire_all()
    return db.query(User).filter(User.email == email).first()


def test_internal_routes_need_the_token(client: TestClient) -> None:
    for path in ("/internal/provision", "/internal/authorize"):
        resp = client.post(path, json={"email": "x@tektalis.com", "suite_user_id": "U"})
        assert resp.status_code == 403
        assert resp.json()["code"] == "FORBIDDEN"


def test_provision_maps_suite_roles_to_ams_roles_and_mirrors_as_global(client: TestClient, db_session: Session) -> None:
    for suite_role, ams_role in (("employee", "EMPLOYEE"), ("manager", "ASSET_MANAGER"), ("admin", "ADMIN")):
        resp = client.post("/internal/provision", headers=TOKEN,
                           json={"email": "New.Person@Tektalis.com", "name": "New Person", "role": suite_role})
        assert resp.status_code == 200, resp.text
        assert resp.json()["role"] == suite_role
        user = local(db_session, "new.person@tektalis.com")
        assert user is not None and user.role.value == ams_role and user.active and user.password_hash is None
        assert access(db_session, "new.person@tektalis.com") == (suite_role, "global")

    resp = client.post("/internal/provision", headers=TOKEN, json={"email": "new.person@tektalis.com", "role": "lead"})
    assert resp.status_code == 422 and resp.json()["code"] == "UNKNOWN_ROLE"


def test_revoking_deactivates_but_not_someone_holding_assets(
    client: TestClient, db_session: Session, manager_headers: dict[str, str]
) -> None:
    category_id = client.get("/api/v1/categories", headers=manager_headers).json()[0]["id"]
    asset = client.post("/api/v1/assets", headers=manager_headers, json={
        "name": "ThinkPad", "category_id": category_id, "serial_no": "SN-SUITE-1",
        "purchase_date": "2026-01-10", "cost": "1000.00", "location": "HQ",
    })
    assert asset.status_code in (200, 201), asset.text
    employee = local(db_session, "employee@tektalis.com")
    assert employee is not None
    assigned = client.post(f"/api/v1/assets/{asset.json()['id']}/assign", headers=manager_headers,
                           json={"user_id": employee.id, "assigned_on": "2026-03-01"})
    assert assigned.status_code == 200, assigned.text

    refused = client.post("/internal/provision", headers=TOKEN, json={"email": "employee@tektalis.com", "role": None})
    assert refused.status_code == 409
    assert refused.json()["code"] == "REFUSED" and "active asset" in refused.json()["message"]
    assert access(db_session, "employee@tektalis.com") == ("employee", "global")  # nothing changed

    ok = client.post("/internal/provision", headers=TOKEN, json={"email": "manager@tektalis.com", "role": None})
    assert ok.status_code == 200 and ok.json()["role"] is None
    assert local(db_session, "manager@tektalis.com").active is False
    assert access(db_session, "manager@tektalis.com") is None


def test_authorize_self_heals_a_missing_ams_user(client: TestClient, db_session: Session) -> None:
    from suite_core import identity

    uid = identity.mirror_access(db_session, email="granted.while.down@tektalis.com", name="Granted",
                                 app="ams", role="manager", source="global")
    db_session.commit()
    assert local(db_session, "granted.while.down@tektalis.com") is None

    resp = client.post("/internal/authorize", headers=TOKEN,
                       json={"suite_user_id": uid, "email": "granted.while.down@tektalis.com", "name": "Granted"})
    assert resp.json() == {"allowed": True, "role": "manager", "code": None}
    user = local(db_session, "granted.while.down@tektalis.com")
    assert user is not None and user.role.value == "ASSET_MANAGER" and user.suite_user_id == uid

    nobody = client.post("/internal/authorize", headers=TOKEN, json={"suite_user_id": "NOPE", "email": "no@tektalis.com"})
    assert nobody.json()["allowed"] is False and nobody.json()["code"] == "NO_APP_ACCESS"


def test_first_visit_creates_the_ams_user_from_the_suite_role(client: TestClient, db_session: Session) -> None:
    from suite_core import identity

    identity.mirror_access(db_session, email="first.visit@tektalis.com", name="First Visit", app="ams",
                           role="employee", source="global")
    db_session.commit()
    me = client.get("/api/v1/auth/me", headers=suite_session("first.visit@tektalis.com"))
    assert me.status_code == 200
    assert me.json()["role"] == "EMPLOYEE" and me.json()["name"] == "First Visit"


def test_boot_links_existing_active_users_only(db_session: Session) -> None:
    from app.common.enums import UserRole

    db_session.add_all([
        User(name="Old Timer", email="old.timer@tektalis.com", role=UserRole.ASSET_MANAGER, active=True),
        User(name="Long Gone", email="long.gone@tektalis.com", role=UserRole.EMPLOYEE, active=False),
    ])
    db_session.commit()
    assert suite.backfill(db_session) == 1
    assert access(db_session, "old.timer@tektalis.com") == ("manager", "app")
    gone = db_session.execute(text("SELECT count(*) FROM app.users WHERE email = 'long.gone@tektalis.com'")).scalar_one()
    assert gone == 0
