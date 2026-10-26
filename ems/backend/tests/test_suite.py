"""TT Suite integration: cookie sign-in, NO_APP_ACCESS, /internal/provision + /internal/authorize, mirror hooks."""
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import text
from suite_core import identity
from suite_core.cookies import hash_session_id, new_session_token

from app.core.config import settings
from app.core.db import SessionLocal
from app.main import app
from app.models import User
from tests.conftest import INTERNAL_TOKEN, XHR

INTERNAL = {"x-internal-token": INTERNAL_TOKEN}


def access(email: str) -> tuple[str, str, str | None] | None:
    """(role, source, updated_by) of `email` in app.app_access for expense, or None."""
    with SessionLocal() as db:
        row = db.execute(text("""SELECT a.role, a.source, a.updated_by FROM app.app_access a JOIN app.users u ON u.id = a.user_id
                                  WHERE u.email = :e AND a.app = 'expense'"""), {"e": email}).first()
    return tuple(row) if row else None


def local(email: str) -> User | None:
    with SessionLocal() as db:
        return db.query(User).filter(User.email == email).first()


def suite_person(email: str, role: str | None) -> tuple[str, TestClient]:
    """An active suite person (optionally with an expense role) holding a session; returns (suite id, client with cookie)."""
    with SessionLocal() as db:
        uid = identity.mirror_access(db, email=email, name="Suite Person", app="expense", role=role, source="global")
        db.execute(text("UPDATE app.users SET status = 'active' WHERE id = :u"), {"u": uid})
        token = new_session_token()
        db.execute(text("INSERT INTO app.session (id, user_id, expires_at) VALUES (:id, :u, :e)"),
                   {"id": hash_session_id(token), "u": uid, "e": datetime.now(UTC) + timedelta(hours=1)})
        db.commit()
    client = TestClient(app, headers=XHR)
    client.cookies.set("tt_session", token)
    return uid, client


def internal(path: str, body: dict, token: str | None = INTERNAL_TOKEN):
    return TestClient(app).post(path, json=body, headers={"x-internal-token": token} if token else {})


# ---------- sign-in through the suite cookie ----------

def test_cookie_resolves_local_user(as_user):
    eshan = as_user("eshan")
    me = eshan.ok("get", "/api/auth/me")
    assert me["email"] == "eshan@example.com"
    assert local("eshan@example.com").suite_user_id  # linked to the suite person
    r = TestClient(app).get("/api/auth/me")  # no cookie
    assert r.status_code == 401 and r.json()["code"] == "UNAUTHENTICATED"
    assert "/api/auth/login" not in {getattr(rt, "path", "") for rt in app.routes}


def test_no_expense_access_is_403_no_app_access():
    _, client = suite_person("outsider@example.com", None)
    r = client.get("/api/auth/me")
    assert r.status_code == 403 and r.json()["code"] == "NO_APP_ACCESS" and r.json()["message"]
    assert local("outsider@example.com") is None


def test_cookie_self_heals_missing_local_user():
    _, client = suite_person("newbie@tektalis.com", "approver")
    me = client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["roles"] == ["APPROVER"] and me.json()["employee_code"] == "NEWBIE"


def test_inactive_local_user_is_403(as_user):
    admin, esha = as_user("admin"), as_user("esha")
    u = next(x for x in admin.ok("get", "/api/admin/users") if x["email"] == "esha@example.com")
    admin.ok("put", f"/api/admin/users/{u['id']}", {**u, "is_active": False})
    assert access("esha@example.com") is None  # mirrored: no access
    r = esha.get("/api/auth/me")
    assert r.status_code == 403 and r.json()["code"] == "NO_APP_ACCESS"
    with SessionLocal() as db:  # even if the suite still says yes, a deactivated EMS user is refused
        identity.mirror_access(db, email="esha@example.com", app="expense", role="member", source="global")
        db.commit()
    assert esha.get("/api/auth/me").status_code == 403


def test_csrf_header_required_and_dev_sign_in_refused_in_prod(as_user, monkeypatch):
    eshan = as_user("eshan")
    r = eshan.client.put("/api/auth/me/notifications", json={"prefs": {}}, headers={"X-Requested-With": ""})
    assert r.status_code == 403 and r.json()["code"] == "CSRF_HEADER_MISSING"
    monkeypatch.setattr(settings, "app_profile", "prod")
    r = TestClient(app, headers=XHR).post("/api/auth/dev/sign-in", json={"email": "eshan@example.com"})
    assert r.status_code == 404


def test_sign_out_everywhere_revokes_suite_sessions(as_user):
    eshan = as_user("eshan")
    other_device = as_user("eshan")
    eshan.ok("post", "/api/auth/me/sign-out-everywhere")
    assert other_device.get("/api/auth/me").status_code == 401
    with SessionLocal() as db:
        n = db.execute(text("SELECT count(*) FROM app.session s JOIN app.users u ON u.id = s.user_id "
                            "WHERE u.email = 'eshan@example.com'")).scalar()
    assert n == 0


# ---------- /internal/provision ----------

def test_internal_routes_need_the_token():
    assert internal("/internal/provision", {"email": "x@example.com", "role": "member"}, token=None).status_code == 403
    assert internal("/internal/provision", {"email": "x@example.com", "role": "member"}, token="wrong").status_code == 403
    assert TestClient(app).post("/api/internal/provision", json={}, headers=INTERNAL).status_code in (403, 404, 405)


def test_provision_create_change_and_revoke(as_user):
    r = internal("/internal/provision", {"email": "Jane.Doe@Example.com", "name": "Jane Doe", "role": "approver",
                                         "source": "global", "actor_id": "01SUITEADMIN"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "approver" and r.json()["local_user_id"]
    jane = local("jane.doe@example.com")
    assert jane.roles == ["APPROVER"] and jane.full_name == "Jane Doe" and jane.employee_code == "JANE-DOE"
    assert access("jane.doe@example.com") == ("approver", "global", "01SUITEADMIN")

    # a second person with the same email local part gets a unique code
    internal("/internal/provision", {"email": "jane.doe@other.com", "role": "member"})
    assert local("jane.doe@other.com").employee_code == "JANE-DOE-2" and local("jane.doe@other.com").roles == []

    # finance -> admin keeps Finance Reviewer (ranks below admin); member clears every role
    internal("/internal/provision", {"email": "fiona@example.com", "role": "admin"})
    assert sorted(local("fiona@example.com").roles) == ["ADMIN", "FINANCE"] and access("fiona@example.com")[0] == "admin"
    internal("/internal/provision", {"email": "fiona@example.com", "role": "member"})
    assert local("fiona@example.com").roles == [] and access("fiona@example.com")[0] == "member"

    # revoke = leaver: deactivated, access row gone, pending approvals move to their manager
    eshan, maya = as_user("eshan"), as_user("maya")
    claim = eshan.submit([eshan.line("Office supplies & equipment", 500)])
    r = internal("/internal/provision", {"email": "maya@example.com", "role": None})
    assert r.status_code == 200 and r.json()["role"] is None
    assert not local("maya@example.com").is_active and access("maya@example.com") is None
    assert as_user("vikram").step_for(claim["id"])  # Maya's step moved to Vikram
    assert maya.get("/api/auth/me").status_code == 403

    # granting again reactivates
    internal("/internal/provision", {"email": "maya@example.com", "role": "approver"})
    assert local("maya@example.com").is_active and access("maya@example.com")[0] == "approver"


def test_provision_refuses_role_conflict():
    # Maya is a Manager; Finance or Admin would make her both (role_conflict), so the portal is refused
    for role in ("finance", "admin"):
        r = internal("/internal/provision", {"email": "maya@example.com", "role": role})
        assert r.status_code == 409 and r.json()["code"] == "ROLE_CONFLICT" and r.json()["detail"]
    assert local("maya@example.com").roles == ["APPROVER"] and access("maya@example.com")[0] == "approver"
    r = internal("/internal/provision", {"email": "maya@example.com", "role": "lead"})
    assert r.status_code == 422 and r.json()["code"] == "UNKNOWN_ROLE"


# ---------- /internal/authorize ----------

def test_authorize_self_heals_and_answers_role():
    with SessionLocal() as db:
        uid = identity.mirror_access(db, email="heal@example.com", name="Heal Me", app="expense", role="finance", source="global")
        nobody = identity.mirror_access(db, email="nobody@example.com", app="expense", role=None, source="global")
        db.commit()
    r = internal("/internal/authorize", {"suite_user_id": uid, "email": "heal@example.com", "name": "Heal Me"})
    assert r.json() == {"allowed": True, "role": "finance", "code": None}
    healed = local("heal@example.com")
    assert healed.roles == ["FINANCE"] and healed.suite_user_id == uid and healed.full_name == "Heal Me"

    r = internal("/internal/authorize", {"suite_user_id": nobody, "email": "nobody@example.com"})
    assert r.json()["allowed"] is False and r.json()["code"] == "NO_APP_ACCESS"

    # seeded users are already mirrored; an EMS-deactivated one is refused
    vikram = local("vikram@example.com")
    assert internal("/internal/authorize", {"suite_user_id": vikram.suite_user_id, "email": vikram.email}).json()["role"] == "approver"
    with SessionLocal() as db:
        db.execute(text("UPDATE expense.users SET is_active = false WHERE email = 'vikram@example.com'"))
        db.commit()
    r = internal("/internal/authorize", {"suite_user_id": vikram.suite_user_id, "email": vikram.email})
    assert r.json()["allowed"] is False and r.json()["code"] == "LOCAL_USER_INACTIVE"


# ---------- mirror hooks (EMS admin -> suite) ----------

def test_seed_users_are_mirrored():
    assert access("admin@example.com")[0] == "admin" and access("fiona@example.com")[0] == "finance"
    assert access("maya@example.com")[0] == "approver" and access("eshan@example.com") == ("member", "app", None)


def test_admin_user_changes_are_mirrored(as_user):
    admin = as_user("admin")
    admin_suite_id = local("admin@example.com").suite_user_id
    new = admin.ok("post", "/api/admin/users", {"email": "Nia@Example.com", "full_name": "Nia Rao", "employee_code": "E300",
                                                "roles": ["FINANCE"]})
    assert access("nia@example.com") == ("finance", "app", admin_suite_id)
    assert local("nia@example.com").suite_user_id
    admin.ok("put", f"/api/admin/users/{new['id']}", {**new, "roles": ["FINANCE", "ADMIN"]})
    assert access("nia@example.com")[0] == "admin"
    admin.ok("put", f"/api/admin/users/{new['id']}", {**new, "roles": []})
    assert access("nia@example.com")[0] == "member"
    admin.ok("put", f"/api/admin/users/{new['id']}", {**new, "email": "nia.rao@example.com", "roles": []})
    assert access("nia@example.com") is None and access("nia.rao@example.com")[0] == "member"  # email change moves access
    admin.ok("put", f"/api/admin/users/{new['id']}", {**new, "email": "nia.rao@example.com", "is_active": False})
    assert access("nia.rao@example.com") is None
    # a refused change (role conflict) mirrors nothing
    assert admin.post("/api/admin/users", {"email": "z@example.com", "full_name": "Zed", "employee_code": "E301",
                                           "roles": ["APPROVER", "FINANCE"]}).status_code == 400
    assert access("z@example.com") is None


def test_csv_import_is_mirrored(as_user):
    admin = as_user("admin")
    csv = ("email,full_name,employee_code,department,location,manager_email,roles,phone,designation\n"
           "imp@example.com,Imp Orted,E400,,,maya@example.com,APPROVER,,\n"
           "eshan@example.com,Eshan Gupta,E010,,,maya@example.com,FINANCE,,\n")
    r = admin.client.post("/api/admin/users/import", files={"file": ("u.csv", csv.encode(), "text/csv")})
    assert r.status_code == 200 and r.json()["created"] == 1 and r.json()["updated"] == 1, r.text
    assert access("imp@example.com")[0] == "approver" and access("eshan@example.com")[0] == "finance"
