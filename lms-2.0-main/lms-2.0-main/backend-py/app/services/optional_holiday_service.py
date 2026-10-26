"""Mirrors backend/src/services/optionalHoliday.service.js +
holidayView.controller.js's LMS-077 holiday-calendar view."""
import math

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, holiday_dao, leave_year_dao, optional_holiday_dao
from app.services import audit_service, config_service


def list_holiday_calendar(db: Session, employee_id: int) -> list:
    """LMS-077: all users view the holiday calendar for the current and next
    leave year, scoped to their own region (plus org-wide holidays)."""
    years = leave_year_dao.list_open_years(db, limit=2)
    employee = employee_dao.find_by_id(db, employee_id)
    return holiday_dao.list_for_years_scoped(db, [y.leave_year_id for y in years], employee.region_id if employee else None)


def get_optional_holiday_quota(db: Session, leave_year_id: int) -> int:
    """Default is HALF of however many optional holidays are published,
    rounded UP — a fixed number would need re-tuning every time the
    published list changes size; rounding up avoids a quota of 0 when only
    1 is published. HR/Admin can override with a flat number (0 = no
    override, use the computed default)."""
    override = config_service.get(db, "holiday.optional_holiday_quota_override")
    if override > 0:
        return override
    total_optional = holiday_dao.count_optional_for_year(db, leave_year_id)
    return math.ceil(total_optional / 2)


def list_eligible_optional_holidays(db: Session, leave_year_id: int, employee_region_id: int | None):
    return holiday_dao.list_eligible_optional(db, leave_year_id, employee_region_id)


def get_optional_holiday_summary(db: Session, employee_id: int, leave_year_id: int, employee_region_id: int | None) -> dict:
    quota = get_optional_holiday_quota(db, leave_year_id)
    eligible = list_eligible_optional_holidays(db, leave_year_id, employee_region_id)
    selections = optional_holiday_dao.list_for_employee_year(db, employee_id, leave_year_id)
    selected_ids = {s.holiday_id for s in selections}

    return {
        "quota": quota, "taken": len(selections), "remaining": max(quota - len(selections), 0),
        "eligible_holidays": [{"holiday": h, "is_selected": h.holiday_id in selected_ids} for h in eligible],
    }


def select_optional_holiday(db: Session, employee_id: int, holiday_id: int):
    holiday = holiday_dao.find_by_id(db, holiday_id)
    if holiday is None:
        raise AppError("NOT_FOUND", "Holiday not found.", status=404)
    if not holiday.is_optional:
        raise AppError("NOT_OPTIONAL", "This holiday is mandatory, not optional — nothing to select.")

    existing = optional_holiday_dao.find_selection(db, employee_id, holiday_id)
    if existing is not None:
        return existing  # idempotent — already selected

    quota = get_optional_holiday_quota(db, holiday.leave_year_id)
    taken_count = optional_holiday_dao.count_for_employee_year(db, employee_id, holiday.leave_year_id)
    if taken_count >= quota:
        raise AppError("OPTIONAL_HOLIDAY_QUOTA_EXCEEDED", f"You've already selected your quota of {quota} optional holiday(s) for this leave year.")

    selection = optional_holiday_dao.create(db, employee_id=employee_id, holiday_id=holiday_id, leave_year_id=holiday.leave_year_id)
    audit_service.record(
        db, action="OPTIONAL_HOLIDAY_SELECTED", entity_type="optional_holiday_selections", entity_id=selection.selection_id,
        actor_id=employee_id, new_value={"holiday_id": holiday_id, "holiday_date": holiday.holiday_date},
    )
    return selection


def deselect_optional_holiday(db: Session, employee_id: int, holiday_id: int) -> dict:
    existing = optional_holiday_dao.find_selection(db, employee_id, holiday_id)
    if existing is None:
        return {"removed": False}

    audit_service.record(
        db, action="OPTIONAL_HOLIDAY_DESELECTED", entity_type="optional_holiday_selections", entity_id=existing.selection_id,
        actor_id=employee_id, prior_value={"holiday_id": holiday_id},
    )
    optional_holiday_dao.delete(db, existing)
    return {"removed": True}


def list_optional_holiday_usage(db: Session, leave_year_id: int) -> dict:
    """HR/Admin view: every active employee's optional-holiday usage for a
    leave year."""
    quota = get_optional_holiday_quota(db, leave_year_id)
    employees = employee_dao.list_active(db)
    selections = optional_holiday_dao.list_for_year(db, leave_year_id)

    taken_by_employee: dict[int, int] = {}
    for s in selections:
        taken_by_employee[s.employee_id] = taken_by_employee.get(s.employee_id, 0) + 1

    rows = []
    for e in sorted(employees, key=lambda e: (e.first_name or "", e.last_name or "")):
        taken = taken_by_employee.get(e.employee_id, 0)
        rows.append({"employee_id": e.employee_id, "full_name": e.full_name, "employee_code": e.employee_code, "taken": taken, "remaining": max(quota - taken, 0)})
    return {"quota": quota, "employees": rows}
