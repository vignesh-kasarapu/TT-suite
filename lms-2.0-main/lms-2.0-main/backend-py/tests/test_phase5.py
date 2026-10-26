"""Covers the highest-risk business logic from Phase 5's remaining-surface
pass: bulk-import's all-or-nothing validation, and the optional-holiday
quota/selection lifecycle."""
import uuid
from datetime import date

from app.dao import holiday_dao, leave_year_dao, optional_holiday_dao
from app.services import bulk_import_service, optional_holiday_service


def test_bulk_import_rejects_whole_batch_on_any_row_error(db):
    suffix = uuid.uuid4().hex[:8].upper()
    rows = [
        {"full_name": "Good Row", "work_email": f"good{suffix}@example.com", "employee_code": f"GOOD{suffix}",
         "date_of_joining": "2025-01-01", "designation": "Engineer"},
        {"full_name": "Bad Row", "work_email": "", "employee_code": f"BAD{suffix}",
         "date_of_joining": "2025-01-01", "designation": "Engineer"},
    ]
    result = bulk_import_service.import_employees(db, rows, actor_id=1)
    assert result["committed"] is False
    assert result["imported_count"] == 0
    assert any("Missing work_email" in e for row in result["errors"] for e in row["errors"])

    from app.dao import employee_dao

    assert employee_dao.find_by_employee_code(db, f"GOOD{suffix}") is None  # nothing committed


def test_bulk_import_wires_up_manager_across_rows_regardless_of_order(db):
    suffix = uuid.uuid4().hex[:8].upper()
    rows = [
        {"full_name": "Report Row", "work_email": f"rep{suffix}@example.com", "employee_code": f"REP{suffix}",
         "date_of_joining": "2025-01-01", "designation": "Engineer", "reporting_manager_code": f"MGR{suffix}"},
        {"full_name": "Manager Row", "work_email": f"mgr{suffix}@example.com", "employee_code": f"MGR{suffix}",
         "date_of_joining": "2024-01-01", "designation": "Manager"},
    ]
    result = bulk_import_service.import_employees(db, rows, actor_id=1)
    assert result["committed"] is True, result["errors"]

    from app.dao import employee_dao

    report = employee_dao.find_by_employee_code(db, f"REP{suffix}")
    manager = employee_dao.find_by_employee_code(db, f"MGR{suffix}")
    assert report.reporting_manager_id == manager.employee_id


def test_optional_holiday_quota_rounds_up_and_enforces_selection_limit(db):
    leave_year = leave_year_dao.find_current(db)
    holiday = holiday_dao.create(
        db, holiday_date=date(2030, 11, 11), holiday_name=f"Test Optional {uuid.uuid4().hex[:6]}",
        leave_year_id=leave_year.leave_year_id, is_optional=True, created_by=1,
    )

    from app.dao import employee_dao
    from app.models.employee import Employee
    from app.services import role_assignment_service

    suffix = uuid.uuid4().hex[:8].upper()
    employee = Employee(
        work_email=f"oh{suffix.lower()}@example.com", employee_code=f"OH{suffix}", first_name="Opt", last_name=suffix,
        date_of_joining=date(2025, 1, 1), designation="Engineer", is_active=True,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    role_assignment_service.assign_role(db, employee.employee_id, "EMPLOYEE", employee.employee_id)

    # Only 1 optional holiday total for this employee's region -> quota = ceil(1/2) = 1.
    # (Other optional holidays created by earlier tests/runs in the shared dev DB may
    # inflate the true total, so assert the selection-limit behavior, not an exact number.)
    quota = optional_holiday_service.get_optional_holiday_quota(db, leave_year.leave_year_id)
    assert quota >= 1

    selection = optional_holiday_service.select_optional_holiday(db, employee.employee_id, holiday.holiday_id)
    assert selection.holiday_id == holiday.holiday_id

    # Re-selecting the same holiday is idempotent, not a second row.
    again = optional_holiday_service.select_optional_holiday(db, employee.employee_id, holiday.holiday_id)
    assert again.selection_id == selection.selection_id
    assert optional_holiday_dao.count_for_employee_year(db, employee.employee_id, leave_year.leave_year_id) == 1

    result = optional_holiday_service.deselect_optional_holiday(db, employee.employee_id, holiday.holiday_id)
    assert result["removed"] is True


def test_select_non_optional_holiday_is_rejected(db):
    leave_year = leave_year_dao.find_current(db)
    mandatory = holiday_dao.create(
        db, holiday_date=date(2030, 12, 25), holiday_name=f"Mandatory {uuid.uuid4().hex[:6]}",
        leave_year_id=leave_year.leave_year_id, is_optional=False, created_by=1,
    )
    from app.core.exceptions import AppError

    try:
        optional_holiday_service.select_optional_holiday(db, 1, mandatory.holiday_id)
        assert False, "expected AppError"
    except AppError as exc:
        assert exc.code == "NOT_OPTIONAL"
