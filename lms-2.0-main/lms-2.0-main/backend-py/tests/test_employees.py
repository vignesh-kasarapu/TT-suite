import uuid

import pytest

from app.core.exceptions import AppError
from app.dao import employee_dao
from tests.conftest import provision_employee


def test_provisioned_employee_gets_completed_by_hr(as_hr_admin, db):
    # New people arrive from the portal with defaults; HR completes the LMS details.
    employee_id = provision_employee(as_hr_admin, name="New Hire")
    res = as_hr_admin.patch(f"/api/employees/{employee_id}", json={
        "designation": "Engineer", "departmentName": "Engineering",
    })
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    assert body["full_name"] == "New Hire"
    assert body["designation"] == "Engineer"
    assert body["department_id"] is not None


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
        "designation": "Lead", "departmentName": "Engineering", "managementLevelId": "", "gender": "",
        "maritalStatus": "", "regionId": "", "gradeId": "",
    })
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    assert body["full_name"] == "Edit Me"
    assert body["designation"] == "Lead"
    assert body["grade_id"] is None and body["region_id"] is None and body["gender"] is None


@pytest.mark.parametrize("field,value", [("fullName", "Renamed Person"), ("workEmail", "renamed@example.com")])
def test_hr_cannot_change_name_or_work_email(as_hr_admin, db, field, value):
    email = f"keep.{uuid.uuid4().hex[:8]}@example.com"
    employee_id = provision_employee(as_hr_admin, email=email, name="Keep Me")
    res = as_hr_admin.patch(f"/api/employees/{employee_id}", json={field: value, "designation": "Lead"})
    assert res.status_code == 422, res.text
    db.commit()
    employee = employee_dao.find_by_id(db, employee_id)
    assert (employee.full_name, employee.work_email, employee.designation) == ("Keep Me", email, "Employee")


def test_self_service_profile_ignores_org_controlled_fields(as_hr_admin, hr_admin):
    res = as_hr_admin.patch("/api/employees/me", json={"designation": "CEO", "phone": "+91 90000 00000"})
    assert res.status_code == 200
    body = res.json()["data"]
    assert body["designation"] == "HR Admin"  # unchanged — designation isn't in the self-service allow-list
    assert body["phone"] == "+91 90000 00000"  # this one is


def test_self_service_profile_cannot_change_the_name(as_hr_admin, hr_admin):
    res = as_hr_admin.patch("/api/employees/me", json={"firstName": "Hacked", "fullName": "Hacked Name"})
    assert res.status_code == 200
    assert res.json()["data"]["full_name"] == "HR Admin"


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


def test_self_service_profile_accepts_empty_date_of_birth(as_hr_admin):
    res = as_hr_admin.patch("/api/employees/me", json={"dateOfBirth": "", "phone": "+91 90000 00001"})
    assert res.status_code == 200, res.text
    assert res.json()["data"]["date_of_birth"] is None


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
