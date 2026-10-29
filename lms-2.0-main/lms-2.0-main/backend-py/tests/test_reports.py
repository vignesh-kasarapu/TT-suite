"""Covers reports_service's manager-scoping intersection logic (BR-39/40) —
the part most likely to silently leak data across a reporting-line boundary
if ported incorrectly."""
import uuid
from datetime import date

from app.dao import leave_request_dao
from app.models.employee import Employee
from app.services import reports_service, role_assignment_service


def _make_employee(db, *, manager_id=None, role_code="EMPLOYEE"):
    suffix = uuid.uuid4().hex[:8].upper()
    employee = Employee(
        work_email=f"rpt{suffix.lower()}@example.com", employee_code=f"RPT{suffix}",
        first_name="Report", last_name=suffix, date_of_joining=date(2025, 1, 1), designation="Engineer",
        reporting_manager_id=manager_id, is_active=True,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    role_assignment_service.assign_role(db, employee.employee_id, role_code, employee.employee_id)
    return employee


def test_manager_scope_excludes_requests_outside_hierarchy(db):
    manager_a = _make_employee(db, role_code="MANAGER")
    report_a = _make_employee(db, manager_id=manager_a.employee_id)
    manager_b = _make_employee(db, role_code="MANAGER")
    report_b = _make_employee(db, manager_id=manager_b.employee_id)

    req_a = leave_request_dao.create(
        db, employee_id=report_a.employee_id, leave_type_id=1, leave_year_id=1,
        start_date=date(2028, 1, 10), end_date=date(2028, 1, 10), reason="a", state="APPROVED", deducted_days=1,
    )
    req_b = leave_request_dao.create(
        db, employee_id=report_b.employee_id, leave_type_id=1, leave_year_id=1,
        start_date=date(2028, 1, 10), end_date=date(2028, 1, 10), reason="b", state="APPROVED", deducted_days=1,
    )
    db.commit()

    rows = reports_service.leave_taken_report(
        db, from_date=date(2028, 1, 1), to_date=date(2028, 1, 31), leave_type_id=None, state=None,
        employee_id=None, department_id=None, grade_id=None, manager_id=None, scope="MANAGER", viewer_id=manager_a.employee_id,
    )
    request_ids = {r.request_id for r, _ in rows}
    assert req_a.request_id in request_ids
    assert req_b.request_id not in request_ids


def test_manager_scope_ignores_employee_id_outside_hierarchy(db):
    """An employeeId filter must intersect with (never replace) the scope
    restriction — a Manager passing an arbitrary employeeId must get zero
    rows, not someone else's data."""
    manager_a = _make_employee(db, role_code="MANAGER")
    stranger = _make_employee(db)

    rows = reports_service.leave_taken_report(
        db, from_date=None, to_date=None, leave_type_id=None, state=None, employee_id=stranger.employee_id,
        department_id=None, grade_id=None, manager_id=None, scope="MANAGER", viewer_id=manager_a.employee_id,
    )
    assert rows == []


def test_lop_report_lists_leave_applied_as_lop(as_hr_admin, hr_admin, db):
    from datetime import date

    from app.dao import leave_type_dao, leave_year_dao
    from app.models.leave_request import LeaveRequest

    lop = leave_type_dao.find_by_code(db, "LOP")
    year = leave_year_dao.find_current(db)
    for state, day in (("APPROVED", date(2027, 2, 1)), ("PENDING_MANAGER", date(2027, 2, 8)), ("REJECTED", date(2027, 2, 15))):
        db.add(LeaveRequest(employee_id=hr_admin.employee_id, leave_type_id=lop.leave_type_id, leave_year_id=year.leave_year_id,
                            start_date=day, end_date=day, reason="lop", state=state, deducted_days=1))
    db.commit()

    rows = as_hr_admin.get("/api/reports/lop", params={"employee_id": hr_admin.employee_id}).json()["data"]
    applied = {r["state"]: r for r in rows if r["source"] == "APPLIED"}
    assert set(applied) == {"APPROVED", "PENDING_MANAGER"}  # a rejected request is not loss of pay
    row = applied["APPROVED"]
    assert row["employee_code"] == hr_admin.employee_code and row["deducted_days"] == 1 and row["applied_at"]
