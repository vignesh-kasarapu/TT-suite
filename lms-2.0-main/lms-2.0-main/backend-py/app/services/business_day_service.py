"""Mirrors backend/src/services/businessDay.service.js — the deduction engine.
BR-03/04/05/06: computes the deducted-working-day breakdown for a date span.
Returns per-day classification so the UI (LMS-036) can render an explicit
breakdown, never a bare number. When employee_id is supplied, each day is
checked against that employee's active working pattern (LMS-015/BR-06) first;
only days with no covering pattern fall back to the organisation-wide default
weekend — this is what makes BR-06's "two employees on the identical calendar
window may fall on opposite sides of a threshold" possible once patterns are
assigned."""
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.dao import holiday_dao
from app.services import config_service, working_pattern_service

WEEKDAY_CODES = ("SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT")


def _each_day(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _find_holidays_for_employee(db: Session, leave_year_id: int, employee_id: int | None):
    """Holidays scoped to the employee's region (or org-wide, region_id null)."""
    return holiday_dao.list_for_employee(db, leave_year_id, employee_id)


def compute_deduction_breakdown(
    db: Session, start_date: date, end_date: date, is_half_day: bool, leave_year_id: int, employee_id: int | None = None
) -> dict:
    org_weekend_days = config_service.get(db, "weekend.days")
    count_weekend = config_service.get(db, "weekend.count_within_leave")
    count_holiday = config_service.get(db, "holiday.count_within_leave")

    holidays = _find_holidays_for_employee(db, leave_year_id, employee_id)
    holiday_names_by_date = {h.holiday_date: h.holiday_name for h in holidays}

    days = []
    for day in _each_day(start_date, end_date):
        weekday_code = WEEKDAY_CODES[(day.weekday() + 1) % 7]  # Python Monday=0 -> align to Sun=0..Sat=6

        pattern_override = (
            working_pattern_service.get_weekend_override_for_date(db, employee_id, day.isoformat())
            if employee_id is not None
            else None
        )
        weekend_days_for_day = pattern_override if pattern_override is not None else org_weekend_days

        is_weekend = weekday_code in weekend_days_for_day
        is_holiday = day in holiday_names_by_date

        # Exclusion precedence: holiday check first, then weekend — a day that
        # is BOTH holiday and weekend, with count_holiday=True and
        # count_weekend=False, is NOT excluded (the holiday branch finds
        # nothing to exclude and the weekend branch never runs). Load-bearing,
        # replicated exactly from Node.
        excluded_reason = None
        if is_holiday and not count_holiday:
            excluded_reason = f"Public holiday ({holiday_names_by_date[day]})"
        elif is_weekend and not count_weekend:
            excluded_reason = "Weekend (individual working pattern)" if pattern_override is not None else "Weekend"

        deducted = excluded_reason is None
        days.append(
            {
                "date": day, "weekday_code": weekday_code, "is_weekend": is_weekend,
                "is_holiday": is_holiday, "deducted": deducted, "excluded_reason": excluded_reason,
            }
        )

    calendar_days_selected = len(days)
    deducted_working_days = sum(1 for d in days if d["deducted"])

    # BR-34 (Section 4.12): half-day requests deduct 0.5, applies to a
    # single-day span — only fires if that single day is itself deductible.
    if is_half_day and deducted_working_days == 1:
        deducted_working_days = 0.5

    return {
        "calendar_days_selected": calendar_days_selected,
        "deducted_working_days": deducted_working_days,
        "days": days,
        "weekend_counted": count_weekend,
        "holidays_counted": count_holiday,
    }
