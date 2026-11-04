"""TT Suite integration (docs/SUITE-CONTRACT.md §3): the suite-cookie auth swap, the
portal's /internal/provision and /internal/authorize routes, and the access mirror."""
import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import text
from suite_core.cookies import hash_session_id, new_session_token
from suite_core.ulid import ulid

from app.core.config import settings
from app.dao import employee_dao, role_dao
from app.models.employee import Employee
from app.models.notification_audit import Notification
from app.models.org_structure import EmployeeRole, Role
from app.services import role_assignment_service
from app.services.employee import lifecycle
from tests.conftest import INTERNAL_TOKEN, sign_in

INTERNAL = {"x-internal-token": INTERNAL_TOKEN}


def _email(prefix="suite"):
    return f"{prefix}.{uuid.uuid4().hex[:8]}@example.com"


def _code(email):
    """The person's global (suite) employee code: the same for the same email."""
    return "G" + uuid.uuid5(uuid.NAMESPACE_DNS, email.lower()).hex[:10].upper()


def _make_employee(db, *, role_code="EMPLOYEE", active=True):
    suffix = uuid.uuid4().hex[:8].upper()
    employee = Employee(
        work_email=f"si{suffix.lower()}@example.com", employee_code=f"SI{suffix}", first_name="Suite",
        last_name=suffix, date_of_joining=date(2025, 1, 1), designation="Engineer", is_active=active,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    role_assignment_service.assign_role(db, employee.employee_id, role_code, None)
    return employee


def _suite_person(db, email, *, role=None, with_session=True, name="Suite Person", code=None):
    """A portal-side person (active), optionally with LMS access and a live session."""
    uid = db.execute(
        text(
            "INSERT INTO app.users (id, email, name, status, employee_code) VALUES (:id, :e, :n, 'active', :c) "
            "ON CONFLICT (email) DO UPDATE SET status = 'active' RETURNING id"
        ),
        {"id": ulid(), "e": email.lower(), "n": name, "c": code if code is not None else _code(email)},
    ).scalar()
    if role is not None:
        db.execute(
            text("INSERT INTO app.app_access (user_id, app, role, source) VALUES (:u, 'lms', :r, 'global')"),
            {"u": uid, "r": role},
        )
    token = None
    if with_session:
        token = new_session_token()
        db.execute(
            text("INSERT INTO app.session (id, user_id, expires_at) VALUES (:s, :u, now() + interval '1 hour')"),
            {"s": hash_session_id(token), "u": uid},
        )
    db.commit()
    return uid, token


def _access(db, email):
    db.commit()  # fresh snapshot
    row = db.execute(
        text(
            "SELECT a.role, a.source, a.updated_by FROM app.app_access a JOIN app.users u ON u.id = a.user_id "
            "WHERE u.email = :e AND a.app = 'lms'"
        ),
        {"e": email.lower()},
    ).first()
    return tuple(row) if row else None


def _only_hr_admin(db, keep_employee_id):
    hr = db.query(Role).filter_by(role_code="HR_ADMIN").first()
    for grant in db.query(EmployeeRole).filter(
        EmployeeRole.role_id == hr.role_id, EmployeeRole.employee_id != keep_employee_id
    ):
        db.delete(grant)
    db.commit()


# ------------------------------------------------------------------ auth swap (§3.1)
def test_suite_cookie_resolves_the_local_employee(client, db):
    employee = _make_employee(db, role_code="MANAGER")
    sign_in(client, employee)
    assert client.cookies.get("tt_session")

    res = client.get("/api/employees/me")
    assert res.status_code == 200, res.text
    me = res.json()["data"]
    me = me.get("employee", me)
    assert me["employee_id"] == employee.employee_id

    db.refresh(employee)
    assert employee.suite_user_id  # bound on sign-in
    assert _access(db, employee.work_email)[0] == "manager"


def test_no_cookie_or_unknown_cookie_is_401(client):
    assert client.get("/api/employees/me").status_code == 401
    client.cookies.set("tt_session", "not-a-session")
    res = client.get("/api/employees/me")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "NO_SESSION"


def test_person_without_lms_access_gets_403_no_app_access(client, db):
    _, token = _suite_person(db, _email("noaccess"), role=None)
    client.cookies.set("tt_session", token)
    res = client.get("/api/employees/me")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "NO_APP_ACCESS"


def test_deactivated_employee_gets_403_no_app_access(client, db):
    employee = _make_employee(db)
    sign_in(client, employee)
    assert client.get("/api/employees/me").status_code == 200

    lifecycle.deactivate(db, employee.employee_id, date.today(), None)
    assert _access(db, employee.work_email) is None  # mirrored to "no access"
    res = client.get("/api/employees/me")
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "NO_APP_ACCESS"


def test_cookie_self_heals_a_missing_local_employee(client, db):
    email = _email("heal")
    uid, token = _suite_person(db, email, role="manager", name="Heal Me")
    client.cookies.set("tt_session", token)

    res = client.get("/api/employees/me")
    assert res.status_code == 200, res.text
    employee = employee_dao.find_by_suite_user_id(db, uid)
    assert employee is not None and employee.work_email == email
    assert "MANAGER" in role_dao.get_role_codes_for_employee(db, employee.employee_id)
    assert _access(db, email) == ("manager", "global", None)  # self-heal leaves the row alone


def test_state_changing_cookie_request_needs_x_requested_with(client, db):
    employee = _make_employee(db)
    sign_in(client, employee)
    res = client.post("/api/auth/signout", headers={"X-Requested-With": ""})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "CSRF_REJECTED"


def test_dev_sign_in_is_refused_in_production(client, db, monkeypatch):
    employee = _make_employee(db)
    monkeypatch.setattr(settings, "app_profile", "prod")
    res = client.post("/api/auth/dev/sign-in", json={"employeeCode": employee.employee_code})
    assert res.status_code == 404


# ------------------------------------------------------------------ provision (§3.2)
def test_internal_routes_require_the_token(client):
    body = {"email": _email(), "role": "employee"}
    res = client.post("/internal/provision", json=body)
    assert res.status_code == 401
    assert res.json()["code"] == "BAD_INTERNAL_TOKEN"
    assert client.post("/internal/provision", json=body, headers={"x-internal-token": "wrong"}).status_code == 401


def test_provision_creates_a_minimal_employee_without_an_invite(client, db):
    email = _email("NewHire").upper()  # suite emails are lower-case; the app normalises
    res = client.post(
        "/internal/provision", headers=INTERNAL,
        json={"email": email, "employee_code": _code(email), "name": "New Hire", "role": "employee", "source": "global"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body == {"ok": True, "local_user_id": body["local_user_id"], "role": "employee"}

    employee = employee_dao.find_by_id(db, int(body["local_user_id"]))
    assert employee.work_email == email.lower()
    assert (employee.first_name, employee.last_name) == ("New", "Hire")
    assert employee.employee_code == _code(email)  # the global code, never one LMS made up
    assert employee.date_of_joining == date.today()
    assert employee.designation == "Employee"
    assert employee.department_id is not None
    assert employee.suite_user_id
    assert role_dao.get_role_codes_for_employee(db, employee.employee_id) == ["EMPLOYEE"]
    assert _access(db, email) == ("employee", "global", None)
    # source=global: the portal sends the suite invite, LMS stays quiet
    assert db.query(Notification).filter_by(
        recipient_id=employee.employee_id, template_key="EMPLOYEE_ONBOARDING_INVITE"
    ).count() == 0
    # ...but onboarding's full entitlement is granted
    balances = db.execute(
        text("SELECT count(*) FROM leave_ledger WHERE employee_id = :e AND entry_type = 'ENTITLEMENT_GRANT'"),
        {"e": employee.employee_id},
    ).scalar()
    assert balances > 0


def test_provision_with_source_app_sends_the_lms_invite(client, db):
    email = _email("appsrc")
    res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "employee_code": _code(email), "role": "employee", "source": "app"})
    assert res.status_code == 200, res.text
    employee_id = int(res.json()["local_user_id"])
    assert db.query(Notification).filter_by(recipient_id=employee_id, template_key="EMPLOYEE_ONBOARDING_INVITE").count() > 0


def test_provision_manager_admin_and_back(client, db):
    admin = _make_employee(db, role_code="HR_ADMIN")  # keeps a second HR admin around
    sign_in(client, admin)  # gives the admin a suite id, used as actor below
    db.refresh(admin)
    email = _email("roles")

    res = client.post("/internal/provision", headers=INTERNAL,
                      json={"email": email, "employee_code": _code(email), "name": "Role Person", "role": "manager", "actor_id": admin.suite_user_id})
    assert res.json()["role"] == "manager"
    employee_id = int(res.json()["local_user_id"])
    assert role_dao.get_role_codes_for_employee(db, employee_id) == ["EMPLOYEE", "MANAGER"]
    assert _access(db, email) == ("manager", "global", admin.suite_user_id)

    res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "employee_code": _code(email), "role": "admin"})
    assert res.json()["role"] == "admin"
    assert {"EMPLOYEE", "HR_ADMIN"} <= set(role_dao.get_role_codes_for_employee(db, employee_id))

    res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "employee_code": _code(email), "role": "employee"})
    assert res.status_code == 200, res.text
    assert res.json()["role"] == "employee"
    assert role_dao.get_role_codes_for_employee(db, employee_id) == ["EMPLOYEE"]
    assert _access(db, email)[0] == "employee"


def test_provision_null_role_deactivates_and_reprovision_reactivates(client, db):
    email = _email("revoke")
    res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "employee_code": _code(email), "role": "manager"})
    employee_id = int(res.json()["local_user_id"])

    res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "employee_code": _code(email), "role": None})
    assert res.status_code == 200, res.text
    assert res.json()["role"] is None
    db.commit()
    employee = employee_dao.find_by_id(db, employee_id)
    assert employee.status == "DEACTIVATED"
    assert _access(db, email) is None

    res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "employee_code": _code(email), "role": "employee"})
    assert res.status_code == 200, res.text
    db.commit()
    assert employee_dao.find_by_id(db, employee_id).status == "ACTIVE"
    assert _access(db, email)[0] == "employee"


def test_provision_refuses_to_remove_the_last_hr_admin(client, db):
    email = _email("lastadmin")
    res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "employee_code": _code(email), "role": "admin"})
    employee_id = int(res.json()["local_user_id"])
    _only_hr_admin(db, employee_id)

    for role in ("employee", None):
        res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "employee_code": _code(email), "role": role})
        assert res.status_code == 400, res.text
        assert res.json()["code"] == "LAST_HR_ADMIN"
    db.commit()
    assert employee_dao.find_by_id(db, employee_id).status == "ACTIVE"
    assert "HR_ADMIN" in role_dao.get_role_codes_for_employee(db, employee_id)
    assert _access(db, email)[0] == "admin"


def test_provision_rejects_an_unknown_role(client):
    res = client.post("/internal/provision", headers=INTERNAL, json={"email": _email(), "employee_code": _code(_email()), "role": "finance"})
    assert res.status_code == 422
    assert res.json()["code"] == "INVALID_ROLE"


def test_provision_without_a_global_code_is_refused(client, db):
    email = _email("nocode")
    res = client.post("/internal/provision", headers=INTERNAL, json={"email": email, "role": "employee"})
    assert res.status_code == 409, res.text
    assert res.json()["code"] == "EMPLOYEE_CODE_MISSING"
    assert employee_dao.find_by_work_email(db, email) is None  # nothing created, no SU- code


def test_provision_with_a_code_another_employee_holds_is_refused(client, db):
    other = _make_employee(db)
    email = _email("clash")
    res = client.post("/internal/provision", headers=INTERNAL,
                      json={"email": email, "employee_code": other.employee_code, "role": "employee"})
    assert res.status_code == 409, res.text
    assert res.json()["code"] == "EMPLOYEE_CODE_TAKEN"


def test_self_heal_without_a_global_code_is_refused(client, db):
    email = _email("heal-nocode")
    uid, _ = _suite_person(db, email, role="employee", with_session=False, code="")
    db.execute(text("UPDATE app.users SET employee_code = NULL WHERE id = :u"), {"u": uid})
    db.commit()
    res = client.post("/internal/authorize", headers=INTERNAL, json={"suite_user_id": uid, "email": email})
    assert res.status_code == 409, res.text
    assert res.json()["code"] == "EMPLOYEE_CODE_MISSING"
    assert employee_dao.find_by_suite_user_id(db, uid) is None


# ------------------------------------------------------------------ authorize (§3.2)
def test_authorize_without_access_is_refused(client, db):
    email = _email("authz-none")
    uid, _ = _suite_person(db, email, role=None, with_session=False)
    res = client.post("/internal/authorize", headers=INTERNAL, json={"suite_user_id": uid, "email": email})
    assert res.status_code == 200
    assert res.json() == {"allowed": False, "role": None, "code": "NO_APP_ACCESS"}


def test_authorize_self_heals_the_local_employee(client, db):
    email = _email("authz-heal")
    uid, _ = _suite_person(db, email, role="admin", with_session=False, name="Ada Admin")
    res = client.post("/internal/authorize", headers=INTERNAL,
                      json={"suite_user_id": uid, "email": email, "name": "Ada Admin"})
    assert res.status_code == 200, res.text
    assert res.json() == {"allowed": True, "role": "admin", "code": None}
    employee = employee_dao.find_by_suite_user_id(db, uid)
    assert employee is not None and employee.first_name == "Ada"
    assert "HR_ADMIN" in role_dao.get_role_codes_for_employee(db, employee.employee_id)


def test_authorize_reports_an_inactive_local_employee(client, db):
    employee = _make_employee(db, active=False)
    uid, _ = _suite_person(db, employee.work_email, role="employee", with_session=False)
    res = client.post("/internal/authorize", headers=INTERNAL,
                      json={"suite_user_id": uid, "email": employee.work_email})
    assert res.json() == {"allowed": False, "role": None, "code": "LOCAL_USER_INACTIVE"}


# ------------------------------------------------------------------ mirror hooks (§3.3)
def test_role_assign_and_revoke_mirror_into_suite_access(hr_admin, client, db):
    # HR no longer has these endpoints; the services (used by /internal/provision) still mirror.
    sign_in(client, hr_admin)  # gives the actor a suite id
    db.refresh(hr_admin)
    employee = _make_employee(db)
    assert _access(db, employee.work_email)[0] == "employee"

    role_assignment_service.assign_role(db, employee.employee_id, "MANAGER", hr_admin.employee_id)
    assert _access(db, employee.work_email) == ("manager", "app", hr_admin.suite_user_id)

    role_assignment_service.revoke_role(db, employee.employee_id, "MANAGER", hr_admin.employee_id)
    assert _access(db, employee.work_email)[0] == "employee"


def test_onboarding_and_reactivation_mirror(hr_admin, db):
    from app.services.employee import onboarding

    email = _email("onboard")
    employee = onboarding.onboard_employee(db, {
        "full_name": "Onboard Person", "work_email": email, "employee_code": f"ON{uuid.uuid4().hex[:6]}",
        "date_of_joining": date.today() - timedelta(days=30), "designation": "Engineer",
        "department_name": "Engineering", "role_code": "MANAGER",
    }, hr_admin.employee_id)
    assert _access(db, email)[0] == "manager"

    lifecycle.deactivate(db, employee.employee_id, date.today(), hr_admin.employee_id)
    assert _access(db, email) is None

    lifecycle.reactivate(db, employee.employee_id, hr_admin.employee_id)
    assert _access(db, email)[0] == "employee"  # roles are not restored on reactivation


# ------------------------------------------------------------------ role-change requests (suite inbox)
def _global_admin(db):
    uid = db.execute(
        text("INSERT INTO app.users (id, email, name, status, is_global_admin) "
             "VALUES (:id, :e, 'Global Admin', 'active', true) RETURNING id"),
        {"id": ulid(), "e": _email("global")},
    ).scalar()
    db.commit()
    return uid


def test_hr_role_request_records_a_pending_request_and_tells_global_admins(as_hr_admin, hr_admin, db):
    admin_id = _global_admin(db)
    email = _email("askrole")
    employee_id = int(as_hr_admin.post("/internal/provision", headers=INTERNAL,
                                       json={"email": email, "employee_code": _code(email), "name": "Ask Role", "role": "employee"}).json()["local_user_id"])
    db.refresh(hr_admin)

    res = as_hr_admin.post(f"/api/employees/{employee_id}/role-request", json={"role": "manager", "note": "Leads QA"})
    assert res.status_code == 201, res.text
    assert res.json()["data"]["role"] == "manager"

    db.commit()
    row = db.execute(text(
        "SELECT r.role, r.status, r.note, r.requested_by FROM app.role_request r JOIN app.users u ON u.id = r.user_id "
        "WHERE u.email = :e AND r.app = 'lms'"), {"e": email}).first()
    assert tuple(row) == ("manager", "pending", "Leads QA", hr_admin.suite_user_id)
    messages = db.execute(text("SELECT kind, title FROM app.message WHERE user_id = :u"), {"u": admin_id}).all()
    assert any(kind == "role_request" and "Ask Role" in title for kind, title in messages)
    # nothing changes locally until the global admin approves it
    assert role_dao.get_role_codes_for_employee(db, employee_id) == ["EMPLOYEE"]
    assert _access(db, email)[0] == "employee"

    listed = as_hr_admin.get("/api/employees/role-requests")
    assert listed.status_code == 200, listed.text
    mine = [r for r in listed.json()["data"] if r["email"] == email]
    assert len(mine) == 1 and mine[0]["role"] == "manager" and mine[0]["employee_id"] == employee_id

    # "No access" is a valid request and replaces the open one
    res = as_hr_admin.post(f"/api/employees/{employee_id}/role-request", json={"role": None})
    assert res.status_code == 201, res.text
    mine = [r for r in as_hr_admin.get("/api/employees/role-requests").json()["data"] if r["email"] == email]
    assert len(mine) == 1 and mine[0]["role"] is None


def test_role_request_rejects_an_unknown_role(as_hr_admin, db):
    employee = _make_employee(db)
    res = as_hr_admin.post(f"/api/employees/{employee.employee_id}/role-request", json={"role": "finance"})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "INVALID_ROLE"


def test_role_request_is_hr_admin_only(client, db):
    manager = _make_employee(db, role_code="MANAGER")
    other = _make_employee(db)
    sign_in(client, manager)
    res = client.post(f"/api/employees/{other.employee_id}/role-request", json={"role": "manager"})
    assert res.status_code == 403
    assert client.get("/api/employees/role-requests").status_code == 403


# ------------------------------------------------------------------ the suite owns the name
def test_suite_name_is_synced_onto_the_employee(client, db):
    employee = _make_employee(db)
    sign_in(client, employee)
    db.refresh(employee)
    db.execute(text("UPDATE app.users SET name = 'Renamed In Portal' WHERE id = :u"), {"u": employee.suite_user_id})
    db.commit()

    res = client.get("/api/employees/me")
    assert res.status_code == 200, res.text
    assert res.json()["data"]["employee"]["full_name"] == "Renamed In Portal"
    db.expire_all()
    employee = employee_dao.find_by_id(db, employee.employee_id)
    assert (employee.first_name, employee.last_name) == ("Renamed", "In Portal")


def test_empty_suite_name_leaves_the_employee_name_alone(client, db):
    employee = _make_employee(db)
    sign_in(client, employee)
    db.refresh(employee)
    before = employee.full_name
    db.execute(text("UPDATE app.users SET name = '' WHERE id = :u"), {"u": employee.suite_user_id})
    db.commit()

    res = client.get("/api/employees/me")
    assert res.status_code == 200, res.text
    assert res.json()["data"]["employee"]["full_name"] == before


@pytest.mark.parametrize("codes,active,expected", [
    (["EMPLOYEE"], True, "employee"),
    (["EMPLOYEE", "MANAGER"], True, "manager"),
    (["EMPLOYEE", "MANAGER", "HR_ADMIN"], True, "admin"),
    (["EMPLOYEE", "HR_ADMIN"], False, None),
])
def test_effective_role(codes, active, expected):
    from app.services.suite_access_service import effective_role_from_codes

    assert effective_role_from_codes(codes, active) == expected
