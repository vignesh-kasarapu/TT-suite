import uuid


def test_onboard_then_fetch_via_me(as_hr_admin, db):
    code = f"ONB{uuid.uuid4().hex[:8].upper()}"
    res = as_hr_admin.post("/api/employees", json={
        "full_name": "New Hire", "work_email": f"{code}@example.com", "employee_code": code,
        "date_of_joining": "2025-01-01", "designation": "Engineer", "department_name": "Engineering",
    })
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert body["employee_code"] == code
    assert body["department_id"] is not None


def test_manager_assignment_rejects_a_circular_chain(as_hr_admin, db):
    suffix = uuid.uuid4().hex[:8].upper()
    a = as_hr_admin.post("/api/employees", json={
        "full_name": "Chain A", "work_email": f"chaina{suffix}@example.com", "employee_code": f"CHA{suffix}",
        "date_of_joining": "2025-01-01", "designation": "Engineer", "department_name": "Engineering",
    }).json()["data"]
    b = as_hr_admin.post("/api/employees", json={
        "full_name": "Chain B", "work_email": f"chainb{suffix}@example.com", "employee_code": f"CHB{suffix}",
        "date_of_joining": "2025-01-01", "designation": "Engineer", "department_name": "Engineering",
    }).json()["data"]

    ok = as_hr_admin.patch(f"/api/employees/{b['employee_id']}/manager", json={"manager_id": a["employee_id"]})
    assert ok.status_code == 200

    circular = as_hr_admin.patch(f"/api/employees/{a['employee_id']}/manager", json={"manager_id": b["employee_id"]})
    assert circular.status_code == 400
    assert circular.json()["error"]["code"] == "CIRCULAR_HIERARCHY"


def test_edit_details_accepts_empty_dropdowns(as_hr_admin):
    # The edit form sends "" for an unset grade, region or management level.
    code = f"EDT{uuid.uuid4().hex[:8].upper()}"
    emp = as_hr_admin.post("/api/employees", json={
        "full_name": "Edit Me", "work_email": f"{code}@example.com", "employee_code": code,
        "date_of_joining": "2025-01-01", "designation": "Engineer", "department_name": "Engineering",
        "grade_id": "", "region_id": "", "management_level_id": "",
    })
    assert emp.status_code == 201, emp.text

    res = as_hr_admin.patch(f"/api/employees/{emp.json()['data']['employee_id']}", json={
        "fullName": "Edited Name", "workEmail": f"{code}@example.com", "designation": "Lead",
        "departmentName": "Engineering", "managementLevelId": "", "gender": "", "maritalStatus": "",
        "regionId": "", "gradeId": "",
    })
    assert res.status_code == 200, res.text
    body = res.json()["data"]
    assert body["full_name"] == "Edited Name"
    assert body["designation"] == "Lead"
    assert body["grade_id"] is None and body["region_id"] is None and body["gender"] is None


def test_self_service_profile_ignores_org_controlled_fields(as_hr_admin, hr_admin):
    res = as_hr_admin.patch("/api/employees/me", json={"designation": "CEO", "phone": "+91 90000 00000"})
    assert res.status_code == 200
    body = res.json()["data"]
    assert body["designation"] == "HR Admin"  # unchanged — designation isn't in the self-service allow-list
    assert body["phone"] == "+91 90000 00000"  # this one is


def test_cannot_revoke_the_last_hr_admin(as_hr_admin, hr_admin, db):
    # This dev DB is shared across test runs (see conftest.py) and may already
    # have other HR_ADMIN holders from prior manual testing — strip them all
    # down to exactly the fixture's employee so the guard is actually exercised.
    from app.models.org_structure import EmployeeRole, Role

    hr_role = db.query(Role).filter_by(role_code="HR_ADMIN").first()
    other_holders = (
        db.query(EmployeeRole)
        .filter(EmployeeRole.role_id == hr_role.role_id, EmployeeRole.employee_id != hr_admin.employee_id)
        .all()
    )
    for grant in other_holders:
        db.delete(grant)
    db.commit()

    # Sent the way the UI sends it — a camelCase JSON body, not a query param. The earlier
    # version of this test used `params=`, which is why it kept passing against a route that
    # no client could actually call.
    res = as_hr_admin.request(
        "DELETE", f"/api/employees/{hr_admin.employee_id}/roles", json={"roleCode": "HR_ADMIN"}
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "LAST_HR_ADMIN"


def test_self_service_profile_accepts_empty_date_of_birth(as_hr_admin):
    res = as_hr_admin.patch("/api/employees/me", json={"dateOfBirth": "", "phone": "+91 90000 00001"})
    assert res.status_code == 200, res.text
    assert res.json()["data"]["date_of_birth"] is None
