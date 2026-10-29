"""Covers the admin CRUD surface added in the second half of Phase 2 —
Department/Region/Grade/Project, LeaveType policy lock, Holiday overlap
warning, WorkingPattern overlap, NotificationTemplate protected-key guard.
Every route here is HR_ADMIN-only (see conftest.py's as_hr_admin fixture)."""
import uuid

from app.models.leave_request import LeaveRequest
from app.services import notification_template_service
from tests.conftest import provision_employee


def test_department_create_then_appears_in_list(as_hr_admin):
    code = f"DPT{uuid.uuid4().hex[:6].upper()}"
    res = as_hr_admin.post("/api/admin/departments", json={"department_code": code, "department_name": "Test Dept"})
    assert res.status_code == 201, res.text

    listed = as_hr_admin.get("/api/admin/departments").json()["data"]
    assert any(d["department_code"] == code for d in listed)


def test_lop_is_edited_and_turned_on_like_any_other_type(as_hr_admin, db):
    from app.dao import leave_type_dao

    lop = leave_type_dao.find_by_code(db, "LOP")
    assert lop is not None and lop.is_system and not lop.is_selectable_by_employee  # off by default

    res = as_hr_admin.patch(f"/api/admin/leave-types/{lop.leave_type_id}/policy",
                            json={"isSelectableByEmployee": True, "genderEligibility": "ALL"})
    assert res.status_code == 200, res.text
    db.expire_all()
    assert leave_type_dao.find_by_code(db, "LOP").is_selectable_by_employee
    assert any(t.type_code == "LOP" for t in leave_type_dao.list_selectable(db))  # now on Apply leave

    off = as_hr_admin.patch(f"/api/admin/leave-types/{lop.leave_type_id}/policy", json={"isSelectableByEmployee": False})
    assert off.status_code == 200, off.text
    db.expire_all()
    assert not any(t.type_code == "LOP" for t in leave_type_dao.list_selectable(db))


def test_holiday_add_warns_about_overlapping_approved_requests(as_hr_admin, hr_admin, db):
    from app.dao import leave_type_dao, leave_year_dao

    leave_type = leave_type_dao.list_all(db)[0]
    leave_year = leave_year_dao.find_current(db)
    lr = LeaveRequest(
        employee_id=hr_admin.employee_id, leave_type_id=leave_type.leave_type_id,
        leave_year_id=leave_year.leave_year_id, start_date="2027-01-10", end_date="2027-01-20",
        reason="test", state="APPROVED",
    )
    db.add(lr)
    db.commit()
    db.refresh(lr)

    res = as_hr_admin.post("/api/admin/holidays", json={
        "holiday_date": "2027-01-15", "holiday_name": "Overlap Test Holiday", "leave_year_id": leave_year.leave_year_id,
    })
    assert res.status_code == 201, res.text
    body = res.json()["data"]
    assert lr.request_id in body["affectedRequestIds"]  # camelCase — see app/schemas/base.py

    as_hr_admin.delete(f"/api/admin/holidays/{body['holiday']['holiday_id']}")
    db.delete(lr)
    db.commit()


def test_holiday_remove_missing_id_is_a_clean_404(as_hr_admin):
    res = as_hr_admin.delete("/api/admin/holidays/999999999")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_working_pattern_assignment_rejects_overlap(as_hr_admin):
    suffix = uuid.uuid4().hex[:6].upper()
    p1 = as_hr_admin.post("/api/admin/working-patterns", json={
        "pattern_code": f"P1{suffix}", "pattern_name": "Pattern One", "weekend_days": ["SAT", "SUN"],
    }).json()["data"]
    p2 = as_hr_admin.post("/api/admin/working-patterns", json={
        "pattern_code": f"P2{suffix}", "pattern_name": "Pattern Two", "weekend_days": ["FRI", "SAT"],
    }).json()["data"]
    emp = {"employee_id": provision_employee(as_hr_admin, email=f"pattern{suffix.lower()}@example.com", name="Pattern Tester")}

    first = as_hr_admin.post("/api/admin/working-pattern-assignments", json={
        "employee_id": emp["employee_id"], "working_pattern_id": p1["working_pattern_id"], "effective_from": "2026-01-01",
    })
    assert first.status_code == 201, first.text

    overlapping = as_hr_admin.post("/api/admin/working-pattern-assignments", json={
        "employee_id": emp["employee_id"], "working_pattern_id": p2["working_pattern_id"], "effective_from": "2026-03-01",
    })
    assert overlapping.status_code == 400
    assert overlapping.json()["error"]["code"] == "WORKING_PATTERN_OVERLAP"


def test_notification_template_protected_key_cannot_be_deleted(as_hr_admin, db):
    key = next(iter(notification_template_service.PROTECTED_TEMPLATE_KEYS))
    from app.dao import notification_template_dao

    if notification_template_dao.find_by_key(db, key) is None:
        notification_template_dao.create(db, template_key=key, subject_template="s", body_template="b", updated_by=None)

    res = as_hr_admin.delete(f"/api/admin/notification-templates/{key}")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "TEMPLATE_IN_USE"


def test_notification_template_duplicate_key_rejected(as_hr_admin):
    key = f"CUSTOM_{uuid.uuid4().hex[:8].upper()}"
    first = as_hr_admin.post("/api/admin/notification-templates", json={
        "template_key": key, "subject_template": "s", "body_template": "b",
    })
    assert first.status_code == 201, first.text

    dup = as_hr_admin.post("/api/admin/notification-templates", json={
        "template_key": key, "subject_template": "s2", "body_template": "b2",
    })
    assert dup.status_code == 400
    assert dup.json()["error"]["code"] == "DUPLICATE_TEMPLATE_KEY"

    as_hr_admin.delete(f"/api/admin/notification-templates/{key}")


def test_holiday_form_payload_is_accepted(as_hr_admin, db):
    # Exactly what HolidayAdmin.jsx sends: camelCase names, "All regions" as no region.
    from app.dao import leave_year_dao

    leave_year = leave_year_dao.find_current(db)
    res = as_hr_admin.post("/api/admin/holidays", json={
        "holidayDate": "2027-02-17", "holidayName": "Form Holiday", "regionId": "", "isOptional": True,
        "leaveYearId": leave_year.leave_year_id,
    })
    assert res.status_code == 201, res.text
    holiday = res.json()["data"]["holiday"]
    assert holiday["holiday_name"] == "Form Holiday" and holiday["region_id"] is None and holiday["is_optional"] is True
