"""Which days somebody is not working: approved leave and the holidays that apply to them.

This is what the other suite apps ask LMS for. Kanban's time log uses it so a person on leave
is not asked to account for eight hours that day, and so nobody has to tell two applications
the same thing twice.

Only facts LMS already owns are reported: a leave request that reached APPROVED (or was
converted to loss of pay, which is still a day away from work), and a holiday that applies to
the person — org-wide or their region, with an optional holiday counting only when they chose
it. Pending requests are not days off: nobody is on leave until it is approved.
"""
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.dao import (
    employee_dao,
    holiday_dao,
    leave_request_query_dao,
    leave_type_dao,
    leave_year_dao,
    optional_holiday_dao,
)

#: States that mean the person is away. A rejected or pending request is not a day off.
AWAY_STATES = ("APPROVED", "LOP_APPLIED", "CANCELLATION_REQUESTED")

LEAVE = "leave"
HOLIDAY = "holiday"


def _dates(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _leave_years_between(db: Session, start: date, end: date) -> list:
    return [y for y in leave_year_dao.list_all(db) if y.start_date <= end and y.end_date >= start]


def days_off_for_employees(
    db: Session, employee_ids: list[int], start: date, end: date
) -> dict[int, dict[date, dict]]:
    """Per employee, the days in [start, end] they are not working, keyed by date.

    A half day of leave is reported as such (`portion` 0.5): the person works the other half,
    so an app that counts hours can halve its expectation rather than skipping the day.
    """
    if not employee_ids or end < start:
        return {}

    out: dict[int, dict[date, dict]] = {employee_id: {} for employee_id in employee_ids}
    window = set(_dates(start, end))
    years = _leave_years_between(db, start, end)

    # --- holidays, per person (region and optional selections differ) ---------------------
    for employee_id in employee_ids:
        employee = employee_dao.find_by_id(db, employee_id)
        if employee is None:
            continue
        for year in years:
            chosen = {
                row.holiday_id
                for row in optional_holiday_dao.list_for_employee_year(db, employee_id, year.leave_year_id)
            }
            for holiday in holiday_dao.list_for_years_scoped(db, [year.leave_year_id], employee.region_id):
                if holiday.holiday_date not in window:
                    continue
                # An optional holiday is a day off only for the people who picked it.
                if holiday.is_optional and holiday.holiday_id not in chosen:
                    continue
                out[employee_id][holiday.holiday_date] = {
                    "kind": HOLIDAY,
                    "label": holiday.holiday_name,
                    "portion": 1.0,
                }

    # --- approved leave ---------------------------------------------------------------------
    requests = leave_request_query_dao.list_for_employees_overlapping(
        db, employee_ids, start, end, AWAY_STATES
    )
    type_names = {t.leave_type_id: t.type_name for t in leave_type_dao.list_all(db)}
    for request in requests:
        label = type_names.get(request.leave_type_id, "Leave")
        portion = 0.5 if request.is_half_day else 1.0
        for day in _dates(max(request.start_date, start), min(request.end_date, end)):
            existing = out.get(request.employee_id, {}).get(day)
            # A holiday inside a leave span stays a holiday: it is the stronger statement, and
            # it is what the leave itself did not deduct.
            if existing is not None and existing["kind"] == HOLIDAY:
                continue
            out.setdefault(request.employee_id, {})[day] = {
                "kind": LEAVE,
                "label": label,
                "portion": portion,
                "request_id": request.request_id,
            }
    return out


def days_off_for_suite_users(
    db: Session, suite_user_ids: list[str], start: date, end: date
) -> list[dict]:
    """The same answer keyed by TT Suite user id — what another app knows a person by.

    Unknown ids are left out rather than refused: an app may ask about somebody who has no
    LMS record yet, and the right answer there is "no days off on record".
    """
    by_suite_id: dict[str, int] = {}
    for suite_user_id in suite_user_ids:
        employee = employee_dao.find_by_suite_user_id(db, suite_user_id)
        if employee is not None:
            by_suite_id[suite_user_id] = employee.employee_id

    found = days_off_for_employees(db, list(by_suite_id.values()), start, end)
    rows = []
    for suite_user_id, employee_id in by_suite_id.items():
        for day, info in sorted(found.get(employee_id, {}).items()):
            rows.append(
                {
                    "suite_user_id": suite_user_id,
                    "date": day,
                    "kind": info["kind"],
                    "label": info["label"],
                    "portion": info["portion"],
                }
            )
    return rows
