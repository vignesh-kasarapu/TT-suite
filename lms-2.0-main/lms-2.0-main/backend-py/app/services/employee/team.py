"""Mirrors employee.service.js's getTeamBalances/getTeamCalendar/getPeerCalendar."""
from datetime import date

from sqlalchemy.orm import Session

from app.dao import employee_dao, leave_request_query_dao, leave_type_dao, leave_year_dao
from app.services import balance_service
from app.services.employee.hierarchy import get_all_reports_recursive

TEAM_CALENDAR_STATES = ("APPROVED", "PENDING_MANAGER", "PENDING_HR")


def get_team_balances(db: Session, manager_id: int) -> list[dict]:
    """BR-39: Manager sees every employee beneath them at any depth. Node's
    getTeamBalances nests just the leave type's NAME (a string) per balance
    entry — a genuinely different shape from the dashboard's nested model,
    not a copy/paste of the same response."""
    leave_year = leave_year_dao.find_current(db)
    selectable_types = leave_type_dao.list_selectable(db)

    rows = []
    for report in get_all_reports_recursive(db, manager_id):
        balances = [
            {
                "leave_type": lt.type_name,
                **balance_service.get_effective_balance(db, report.employee_id, lt.leave_type_id, leave_year.leave_year_id),
            }
            for lt in selectable_types
        ]
        rows.append({"employee": report, "balances": balances})
    return rows


def get_team_calendar(db: Session, manager_id: int, start_date: date, end_date: date) -> list[dict]:
    """Section 7.3.7: every employee beneath the manager at any depth, WITH
    leave type shown — distinct from the peer calendar, which never sends type."""
    reports = get_all_reports_recursive(db, manager_id)
    employee_ids = [r.employee_id for r in reports]
    by_id = {r.employee_id: r for r in reports}
    requests = leave_request_query_dao.list_for_employees_overlapping(db, employee_ids, start_date, end_date, TEAM_CALENDAR_STATES)

    types = {t.leave_type_id: t for t in leave_type_dao.list_all(db)}
    return [
        {
            "request_id": r.request_id, "employee_id": r.employee_id,
            "employee_name": _name(by_id.get(r.employee_id)), "employee": _person(by_id.get(r.employee_id)),
            "start_date": r.start_date, "end_date": r.end_date, "state": r.state,
            "leave_type_id": r.leave_type_id, "leave_type_name": _type_name(types.get(r.leave_type_id)),
            "LeaveType": _leave_type(types.get(r.leave_type_id)),
            # The day inspector shows how much was deducted and why — a calendar entry without
            # them is just a coloured box.
            "deducted_days": float(r.deducted_days) if r.deducted_days is not None else None,
            "is_half_day": r.is_half_day, "half_day_portion": r.half_day_portion, "reason": r.reason,
        }
        for r in requests
    ]


def _name(employee) -> str | None:
    return employee.full_name if employee else None


def _person(employee) -> dict | None:
    if employee is None:
        return None
    return {
        "employee_id": employee.employee_id, "employee_code": employee.employee_code,
        "full_name": employee.full_name, "designation": employee.designation,
    }


def _type_name(leave_type) -> str | None:
    return leave_type.type_name if leave_type else None


def _leave_type(leave_type) -> dict | None:
    if leave_type is None:
        return None
    return {
        "leave_type_id": leave_type.leave_type_id, "type_code": leave_type.type_code,
        "type_name": leave_type.type_name,
    }


def get_peer_calendar(db: Session, employee_id: int, start_date: date, end_date: date) -> list[dict]:
    """BR-41/NFR-14: peers = same reporting_manager_id AND same
    management_level_id. Shows name, dates, status only — never leave type."""
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None or employee.reporting_manager_id is None:
        return []

    all_active = employee_dao.list_active(db)
    peers = [
        e for e in all_active
        if e.employee_id != employee_id
        and e.reporting_manager_id == employee.reporting_manager_id
        and e.management_level_id == employee.management_level_id
    ]
    peer_ids = [p.employee_id for p in peers]
    requests = leave_request_query_dao.list_for_employees_overlapping(db, peer_ids, start_date, end_date, TEAM_CALENDAR_STATES)

    by_id = {p.employee_id: p for p in peers}
    # Deliberately no leave type, deducted days or reason here — BR-41/NFR-14 limit a peer to
    # name, dates and status. The nested `employee` only repeats the name the row already shows.
    return [
        {
            "request_id": r.request_id, "employee_id": r.employee_id,
            "employee_name": _name(by_id.get(r.employee_id)), "employee": _person(by_id.get(r.employee_id)),
            "start_date": r.start_date, "end_date": r.end_date, "state": r.state,
        }
        for r in requests
    ]
