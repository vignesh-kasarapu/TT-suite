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
    esha = as_user("esha")
    assert internal("/internal/provision", {"email": "esha@example.com", "role": None}).status_code == 200  # leaver
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


def test_sign_out_everywhere_endpoint_removed(as_user):
    eshan = as_user("eshan")  # the portal's /signout asks "this device or all devices"
    assert eshan.post("/api/auth/me/sign-out-everywhere").status_code in (404, 405)


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


def test_admin_cannot_create_or_change_access(as_user):
    admin = as_user("admin")
    esha = next(u for u in admin.ok("get", "/api/admin/users") if u["email"] == "esha@example.com")
    assert admin.post("/api/admin/users", {"email": "nia@example.com", "full_name": "Nia Rao", "employee_code": "E300",
                                           "roles": ["FINANCE"]}).status_code == 405
    assert access("nia@example.com") is None and local("nia@example.com") is None
    # roles, active, email and name in the body are ignored: only Expense details change
    admin.ok("put", f"/api/admin/users/{esha['id']}", {**esha, "roles": ["ADMIN"], "is_active": False,
                                                      "email": "other@example.com", "full_name": "Other",
                                                      "employee_code": "E777", "designation": "Lead"})
    after = local("esha@example.com")
    assert after.roles == esha["roles"] and after.is_active and after.full_name == esha["full_name"]
    assert after.employee_code == "E777" and after.designation == "Lead"
    assert access("esha@example.com")[0] == "member"
    r = admin.client.post("/api/admin/users/import", files={"file": ("u.csv", b"email\n", "text/csv")})
    assert r.status_code in (404, 405)


# ---------- role-change requests (EMS Admin -> global admin inbox) ----------

def _global_admin(email: str) -> str:
    with SessionLocal() as db:
        uid = identity.mirror_access(db, email=email, name="Grace Global", app="expense", role=None, source="global")
        db.execute(text("UPDATE app.users SET is_global_admin = true, status = 'active' WHERE id = :u"), {"u": uid})
        db.commit()
    return uid


def test_role_request_goes_to_global_admins(as_user):
    admin = as_user("admin")
    ga1, ga2 = _global_admin("ga1@example.com"), _global_admin("ga2@example.com")
    eshan = next(u for u in admin.ok("get", "/api/admin/users") if u["email"] == "eshan@example.com")
    r = admin.ok("post", f"/api/admin/users/{eshan['id']}/role-request", {"role": "approver", "note": "Leads a team now"})
    assert r["role"] == "approver" and r["id"]
    with SessionLocal() as db:
        row = db.execute(text("""SELECT r.status, r.role, r.note, r.requested_by FROM app.role_request r
                                  JOIN app.users u ON u.id = r.user_id
                                 WHERE u.email = 'eshan@example.com' AND r.app = 'expense'""")).one()
        msgs = db.execute(text("SELECT user_id FROM app.message WHERE kind = 'role_request'")).all()
    assert tuple(row) == ("pending", "approver", "Leads a team now", local("admin@example.com").suite_user_id)
    assert sorted(m[0] for m in msgs) == sorted([ga1, ga2])
    pending = admin.ok("get", "/api/admin/role-requests")
    assert [(p["email"], p["role"]) for p in pending] == [("eshan@example.com", "approver")]
    # nothing changes until the global admin approves
    assert local("eshan@example.com").roles == [] and access("eshan@example.com")[0] == "member"
    # a new request replaces the open one; None = remove access
    admin.ok("post", f"/api/admin/users/{eshan['id']}/role-request", {"role": None})
    assert [(p["email"], p["role"]) for p in admin.ok("get", "/api/admin/role-requests")] == [("eshan@example.com", None)]


def test_role_request_refusals(as_user):
    admin, eshan = as_user("admin"), as_user("eshan")
    uid = eshan.user["id"]
    assert eshan.post(f"/api/admin/users/{uid}/role-request", {"role": "finance"}).status_code == 403
    assert eshan.get("/api/admin/role-requests").status_code == 403
    assert admin.post(f"/api/admin/users/{uid}/role-request", {"role": "lead"}).status_code == 422
    assert admin.post("/api/admin/users/999999/role-request", {"role": "member"}).status_code == 404
    with SessionLocal() as db:
        assert db.execute(text("SELECT count(*) FROM app.role_request")).scalar() == 0


# ---------- the name comes from the suite ----------

def test_suite_name_replaces_local_name(as_user):
    eshan = as_user("eshan")
    with SessionLocal() as db:
        db.execute(text("UPDATE app.users SET name = 'Eshan G. Gupta' WHERE email = 'eshan@example.com'"))
        db.commit()
    assert eshan.ok("get", "/api/auth/me")["full_name"] == "Eshan G. Gupta"
    assert local("eshan@example.com").full_name == "Eshan G. Gupta"
    with SessionLocal() as db:  # an empty suite name keeps the local one
        db.execute(text("UPDATE app.users SET name = '' WHERE email = 'eshan@example.com'"))
        db.commit()
    assert eshan.ok("get", "/api/auth/me")["full_name"] == "Eshan G. Gupta"
