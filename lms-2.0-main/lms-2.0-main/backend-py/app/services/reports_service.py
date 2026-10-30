"""Mirrors backend/src/services/reports.service.js + the audit-log portion of
reports.controller.js."""
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import audit_dao, ledger_dao, lop_record_dao, leave_request_query_dao
from app.services.employee.hierarchy import get_all_reports_recursive


def leave_taken_report(
    db: Session, *, from_date: date | None, to_date: date | None, leave_type_id: int | None, state: str | None,
    employee_id: int | None, department_id: int | None, grade_id: int | None, manager_id: int | None,
    scope: str, viewer_id: int,
) -> list[tuple]:
    """LMS-074/075. Scope: Manager sees their hierarchy only (BR-39); HR/Admin
    sees everyone (BR-40). An employee_id filter must intersect with (never
    replace) that scope restriction."""
    scope_ids: list[int] | None = None
    if scope == "MANAGER":
        scope_ids = [r.employee_id for r in get_all_reports_recursive(db, viewer_id)]

    # manager_id filter (HR/Admin picking "show me this manager's team"):
    # intersect with any existing scope restriction, so it can only narrow.
    if manager_id is not None:
        manager_team_ids = {r.employee_id for r in get_all_reports_recursive(db, manager_id)}
        scope_ids = [i for i in scope_ids if i in manager_team_ids] if scope_ids is not None else list(manager_team_ids)

    return leave_request_query_dao.list_for_report(
        db, from_date=from_date, to_date=to_date, leave_type_id=leave_type_id, state=state,
        employee_id=employee_id, employee_ids=scope_ids, department_id=department_id, grade_id=grade_id,
    )


def lop_scope_ids(db: Session, scope: str, viewer_id: int, manager_id: int | None) -> list[int] | None:
    """Which employees' loss of pay a viewer may see. HR/Admin sees everyone (None = no
    restriction); a Manager sees their reporting line and themselves; everyone else sees
    only their own. A manager_id filter can only narrow what the scope already allows.
    """
    scope_ids: list[int] | None = None
    if scope == "MANAGER":
        scope_ids = [viewer_id, *(r.employee_id for r in get_all_reports_recursive(db, viewer_id))]
    elif scope != "HR":
        scope_ids = [viewer_id]

    if manager_id is not None:
        manager_team_ids = {r.employee_id for r in get_all_reports_recursive(db, manager_id)}
        scope_ids = [i for i in scope_ids if i in manager_team_ids] if scope_ids is not None else list(manager_team_ids)
    return scope_ids


def lop_report(db: Session, *, from_date: date | None, to_date: date | None, employee_id: int | None, manager_id: int | None,
               scope: str = "HR", viewer_id: int | None = None):
    """LMS-078: LOP report for downstream payroll consumption — no salary
    calculation performed here."""
    employee_ids = lop_scope_ids(db, scope, viewer_id, manager_id)
    return lop_record_dao.list_for_report(db, from_date=from_date, to_date=to_date, employee_id=employee_id, employee_ids=employee_ids)


def lop_advance_report(db: Session, *, from_date: date | None, to_date: date | None, employee_id: int | None, manager_id: int | None,
                       scope: str = "HR", viewer_id: int | None = None):
    """Approved advance leave whose days beyond the balance are loss of pay."""
    employee_ids = lop_scope_ids(db, scope, viewer_id, manager_id)
    return leave_request_query_dao.list_advance_lop(
        db, from_date=from_date, to_date=to_date, employee_id=employee_id, employee_ids=employee_ids
    )


def lop_applied_report(db: Session, *, from_date: date | None, to_date: date | None, employee_id: int | None, manager_id: int | None,
                       scope: str = "HR", viewer_id: int | None = None):
    """Leave employees applied for as LOP (approved or pending), same filters as lop_report."""
    employee_ids = lop_scope_ids(db, scope, viewer_id, manager_id)
    return leave_request_query_dao.list_applied_lop(
        db, from_date=from_date, to_date=to_date, employee_id=employee_id, employee_ids=employee_ids
    )


def lop_pending_report(db: Session, scope: str = "HR", viewer_id: int | None = None):
    """Rejected advance leave still inside its withdrawal window — days that are at risk of
    becoming loss of pay but have not yet, so payroll can see what is coming. Filtered to
    what the viewer may see, the same way the LOP report itself is."""
    from datetime import datetime, timezone

    rows = leave_request_query_dao.list_pending_lop_conversions(db, datetime.now(timezone.utc))
    allowed = lop_scope_ids(db, scope, viewer_id, None)
    if allowed is None:
        return rows
    allowed_set = set(allowed)
    return [r for r in rows if r.employee_id in allowed_set]


def balances_report(db: Session, leave_year_id: int | None):
    if leave_year_id is None:
        raise AppError("MISSING_LEAVE_YEAR_ID", "leaveYearId is required.")
    return ledger_dao.list_for_leave_year(db, leave_year_id)


def audit_log_report(
    db: Session, *, actor_id: int | None, action: str | None, entity_type: str | None,
    from_ts: datetime | None, to_ts: datetime | None,
):
    """LMS-080: HR/Admin views and filters the audit log (R2)."""
    return audit_dao.list_filtered(db, actor_id=actor_id, action=action, entity_type=entity_type, from_ts=from_ts, to_ts=to_ts, limit=200)
