import uuid

import pytest

from app.core.exceptions import AppError
from app.dao import employee_dao
from tests.conftest import provision_employee


def test_provisioned_employee_gets_completed_by_hr(as_hr_admin, db):
    # New people arrive from the portal with defaults; HR completes what LMS owns — the
    # department, grade, region and management level. Their job title, gender and marital
    # status come from the suite profile and are refused here.
    employee_id = provision_employee(as_hr_admin, name="New Hire")
    res = as_hr_admin.patch(f"/api/employees/{employee_id}", json={"departmentName": "Engineering"})
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    assert body["full_name"] == "New Hire"
    assert body["department_id"] is not None


def test_hr_cannot_change_what_the_suite_profile_owns(as_hr_admin):
    employee_id = provision_employee(as_hr_admin, name="Suite Owned")
    for field in ("designation", "gender", "maritalStatus"):
        res = as_hr_admin.patch(f"/api/employees/{employee_id}", json={field: "FEMALE"})
        assert res.status_code == 409, f"{field}: {res.text}"
        assert res.json()["error"]["code"] == "EDIT_IN_SUITE_PROFILE"


def test_manager_assignment_rejects_a_circular_chain(as_hr_admin, db):
    a = provision_employee(as_hr_admin, name="Chain A")
    b = provision_employee(as_hr_admin, name="Chain B")

    ok = as_hr_admin.patch(f"/api/employees/{b}/manager", json={"manager_id": a})
    assert ok.status_code == 200

    circular = as_hr_admin.patch(f"/api/employees/{a}/manager", json={"manager_id": b})
    assert circular.status_code == 400
    assert circular.json()["error"]["code"] == "CIRCULAR_HIERARCHY"


def test_edit_details_accepts_empty_dropdowns(as_hr_admin):
    # The edit form sends "" for an unset grade, region or management level.
    employee_id = provision_employee(as_hr_admin, name="Edit Me")
    res = as_hr_admin.patch(f"/api/employees/{employee_id}", json={
        "departmentName": "Engineering", "managementLevelId": "", "regionId": "", "gradeId": "",
    })
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    assert body["full_name"] == "Edit Me"
    assert body["grade_id"] is None and body["region_id"] is None


@pytest.mark.parametrize("field,value", [("fullName", "Renamed Person"), ("workEmail", "renamed@example.com")])
def test_hr_cannot_change_name_or_work_email(as_hr_admin, db, field, value):
    email = f"keep.{uuid.uuid4().hex[:8]}@example.com"
    employee_id = provision_employee(as_hr_admin, email=email, name="Keep Me")
    res = as_hr_admin.patch(f"/api/employees/{employee_id}", json={field: value, "designation": "Lead"})
    assert res.status_code == 422, res.text
    db.commit()
    employee = employee_dao.find_by_id(db, employee_id)
    assert (employee.full_name, employee.work_email, employee.designation) == ("Keep Me", email, "Employee")


def test_personal_details_are_edited_in_the_suite_profile_not_here(as_hr_admin, hr_admin):
    """The suite owns a person's own details and LMS re-copies them on every request, so a
    value written here would be overwritten on the next page load. The endpoint says where
    to go instead of accepting it."""
    res = as_hr_admin.patch("/api/employees/me", json={"phone": "+91 90000 00000"})
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "EDIT_IN_SUITE_PROFILE"


def test_self_service_profile_cannot_change_org_controlled_fields(as_hr_admin, hr_admin):
    """Designation and the name are not in the request schema at all, so they are dropped
    before the service sees them — the request succeeds and changes nothing."""
    res = as_hr_admin.patch("/api/employees/me", json={"designation": "CEO", "firstName": "Hacked"})
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    assert body["designation"] == "HR Admin"
    assert body["full_name"] == "HR Admin"


def test_cannot_revoke_the_last_hr_admin(hr_admin, db):
    # The guard now protects the portal's provision path (and the service behind it);
    # see test_suite_integration.test_provision_refuses_to_remove_the_last_hr_admin too.
    from app.models.org_structure import EmployeeRole, Role
    from app.services import role_assignment_service

    hr_role = db.query(Role).filter_by(role_code="HR_ADMIN").first()
    for grant in db.query(EmployeeRole).filter(
        EmployeeRole.role_id == hr_role.role_id, EmployeeRole.employee_id != hr_admin.employee_id
    ).all():
        db.delete(grant)
    db.commit()

    with pytest.raises(AppError) as exc:
        role_assignment_service.revoke_role(db, hr_admin.employee_id, "HR_ADMIN", hr_admin.employee_id)
    assert exc.value.code == "LAST_HR_ADMIN"
    db.rollback()


def test_every_personal_field_is_refused_here(as_hr_admin):
    for field, value in (
        ("dateOfBirth", "1990-01-01"), ("personalEmail", "me@example.com"), ("gender", "MALE"),
        ("maritalStatus", "SINGLE"), ("emergencyContactName", "Someone"), ("emergencyContactPhone", "+91 90000 00002"),
    ):
        res = as_hr_admin.patch("/api/employees/me", json={field: value})
        assert res.status_code == 409, f"{field}: {res.text}"
        assert res.json()["error"]["code"] == "EDIT_IN_SUITE_PROFILE"


# ------------------------------------------------------------------ removed from LMS (portal only)
def test_account_and_role_endpoints_are_gone(as_hr_admin, hr_admin):
    employee_id = provision_employee(as_hr_admin)
    onboard = as_hr_admin.post("/api/employees", json={
        "fullName": "X", "workEmail": "x@example.com", "employeeCode": "X1", "dateOfJoining": "2025-01-01",
        "designation": "Engineer",
    })
    assert onboard.status_code in (404, 405)
    bulk = as_hr_admin.post("/api/employees/bulk-import", files={"file": ("a.csv", b"full_name\n", "text/csv")})
    assert bulk.status_code in (404, 405)
    assign = as_hr_admin.post(f"/api/employees/{employee_id}/roles", json={"roleCode": "MANAGER"})
    assert assign.status_code in (404, 405)
    revoke = as_hr_admin.request("DELETE", f"/api/employees/{employee_id}/roles", json={"roleCode": "MANAGER"})
    assert revoke.status_code in (404, 405)
    deactivate = as_hr_admin.post(f"/api/employees/{employee_id}/deactivate", json={"lastWorkingDay": "2026-01-01"})
    assert deactivate.status_code in (404, 405)
    reactivate = as_hr_admin.post(f"/api/employees/{employee_id}/reactivate")
    assert reactivate.status_code in (404, 405)


def test_hr_adds_and_renames_departments_and_regions(as_hr_admin):
    # Edit employee's "+" sends only a name; the code is derived from it.
    tag = uuid.uuid4().hex[:6]
    for kind, key in (("departments", "department"), ("regions", "region")):
        added = as_hr_admin.post(f"/api/admin/{kind}", json={f"{key}Name": f"North {tag}"})
        assert added.status_code == 201, added.text
        row = added.json()["data"]
        assert row[f"{key}_code"] == f"NORTH_{tag.upper()}"

        again = as_hr_admin.post(f"/api/admin/{kind}", json={f"{key}Name": f"north {tag}"})
        assert again.status_code == 409, again.text

        other = as_hr_admin.post(f"/api/admin/{kind}", json={f"{key}Name": f"South {tag}"}).json()["data"]
        renamed = as_hr_admin.patch(f"/api/admin/{kind}/{row[f'{key}_id']}", json={f"{key}Name": f"East {tag}"})
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["data"][f"{key}_name"] == f"East {tag}"
        clash = as_hr_admin.patch(f"/api/admin/{kind}/{other[f'{key}_id']}", json={f"{key}Name": f"East {tag}"})
        assert clash.status_code == 409, clash.text
        blank = as_hr_admin.patch(f"/api/admin/{kind}/{other[f'{key}_id']}", json={f"{key}Name": "  "})
        assert blank.status_code == 400, blank.text


def test_leave_types_hr_unticks_leave_the_dashboard_and_are_refused(as_hr_admin, client, db):
    from datetime import date, timedelta

    from tests.conftest import sign_in

    employee_id = provision_employee(as_hr_admin, name="Picky Types")
    types = as_hr_admin.get(f"/api/employees/{employee_id}/leave-types").json()["data"]
    assert types and all(t["applicable"] for t in types)
    dropped = types[0]["leave_type_id"]
    keep = [t["leave_type_id"] for t in types[1:]]

    res = as_hr_admin.patch(f"/api/employees/{employee_id}", json={"applicableLeaveTypeIds": keep})
    assert res.status_code == 200, res.text
    after = {t["leave_type_id"]: t["applicable"] for t in as_hr_admin.get(f"/api/employees/{employee_id}/leave-types").json()["data"]}
    assert after[dropped] is False and all(after[i] for i in keep)

    unknown = as_hr_admin.patch(f"/api/employees/{employee_id}", json={"applicableLeaveTypeIds": [987654]})
    assert unknown.status_code == 400, unknown.text

    db.commit()
    sign_in(client, employee_dao.find_by_id(db, employee_id))
    shown = [b["leaveType"]["leave_type_id"] for b in client.get("/api/employees/dashboard").json()["data"]["balances"]]
    assert dropped not in shown and set(keep) <= set(shown)

    day = date.today() + timedelta(days=220)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    submit = client.post("/api/leave-requests", json={
        "leave_type_id": dropped, "start_date": day.isoformat(), "end_date": day.isoformat(), "reason": "test",
    })
    assert submit.status_code == 400, submit.text
    assert submit.json()["error"]["code"] == "TYPE_NOT_APPLICABLE"


def test_lms_admins_are_notified_when_a_new_person_joins(as_hr_admin, hr_admin, db):
    from app.models.notification_audit import Notification

    employee_id = provision_employee(as_hr_admin, name="Fresh Joiner")
    db.commit()
    rows = db.query(Notification).filter(
        Notification.recipient_id == hr_admin.employee_id, Notification.template_key == "EMPLOYEE_JOINED",
        Notification.channel == "IN_APP",
    ).all()
    assert any("Fresh Joiner" in r.subject for r in rows)
    shown = as_hr_admin.get("/api/notifications").json()["data"]
    assert any("Fresh Joiner" in (n.get("subject") or "") for n in shown), shown[:2]
    # Re-provisioning an existing person is not a new joiner.
    before = len(rows)
    provision_employee(as_hr_admin, email=employee_dao.find_by_id(db, employee_id).work_email, name="Fresh Joiner")
    db.commit()
    after = db.query(Notification).filter(
        Notification.recipient_id == hr_admin.employee_id, Notification.template_key == "EMPLOYEE_JOINED",
    ).count()
    assert after == before


def test_hr_sets_a_reporting_manager_from_the_edit_dialog(as_hr_admin, db):
    manager_id = provision_employee(as_hr_admin, name="Boss Person", role="manager")
    employee_id = provision_employee(as_hr_admin, name="Team Member")
    res = as_hr_admin.post(f"/api/employees/{employee_id}/reassign-manager", json={"newManagerId": manager_id})
    assert res.status_code == 200, res.text
    db.commit()
    assert employee_dao.find_by_id(db, employee_id).reporting_manager_id == manager_id
    listed = {e["employee_id"]: e for e in as_hr_admin.get("/api/employees").json()["data"]}
    assert "MANAGER" in listed[manager_id]["roles"] and listed[employee_id]["reporting_manager_id"] == manager_id

    # The notification names both people with their codes (not "employee #2").
    from app.models.notification_audit import Notification

    boss, member = employee_dao.find_by_id(db, manager_id), employee_dao.find_by_id(db, employee_id)
    note = db.query(Notification).filter(
        Notification.recipient_id == employee_id, Notification.template_key == "MANAGER_REASSIGNED",
        Notification.channel == "IN_APP",
    ).first()
    assert note is not None
    assert f"Team Member ({member.employee_code}) now reports to Boss Person ({boss.employee_code})" in note.body
    assert "employee #" not in note.body
