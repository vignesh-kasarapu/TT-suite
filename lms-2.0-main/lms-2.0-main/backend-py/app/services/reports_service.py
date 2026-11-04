"""Mirrors backend/src/services/reports.service.js + the audit-log portion of
reports.controller.js."""
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import (
    audit_dao, comp_off_dao, employee_dao, encashment_dao, leave_request_query_dao, leave_type_dao,
    leave_year_dao, ledger_dao, lop_record_dao,
)
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


def encashment_report(
    db: Session, *, from_date=None, to_date=None, employee_id: int | None, leave_year_id: int | None,
    status: str | None, manager_id: int | None, scope: str = "HR", viewer_id: int | None = None,
):
    """Encashment requests the viewer may see — same scope rule as the LOP report."""
    employee_ids = lop_scope_ids(db, scope, viewer_id, manager_id)
    return encashment_dao.list_for_report(
        db, from_date=from_date, to_date=to_date, employee_id=employee_id, employee_ids=employee_ids,
        status=status, leave_year_id=leave_year_id,
    )


def comp_off_report(
    db: Session, *, from_date=None, to_date=None, employee_id: int | None, status: str | None,
    manager_id: int | None, scope: str = "HR", viewer_id: int | None = None,
):
    """Compensatory-off claims the viewer may see."""
    employee_ids = lop_scope_ids(db, scope, viewer_id, manager_id)
    return comp_off_dao.list_for_report(
        db, from_date=from_date, to_date=to_date, employee_id=employee_id, employee_ids=employee_ids, status=status,
    )


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


# --- the entitlement reports (§16) ------------------------------------------------------------


def entitlement_report(db: Session, *, leave_year_id: int | None, scope: str = "HR", viewer_id: int | None = None,
                       manager_id: int | None = None, employee_id: int | None = None) -> list[dict]:
    """One row per employee and target: what was granted, carried, adjusted, used, held back
    and left. The same calculation the dashboards read, so the two can never disagree.
    """
    from app.services import entitlement_service

    leave_year = leave_year_dao.find_by_id(db, leave_year_id) if leave_year_id else leave_year_dao.find_current(db)
    if leave_year is None:
        raise AppError("NOT_FOUND", "Leave year not found.", status=404)

    allowed = lop_scope_ids(db, scope, viewer_id, manager_id)
    targets = entitlement_service.grantable_targets(db)
    rows = []
    for employee in employee_dao.list_active(db):
        if allowed is not None and employee.employee_id not in allowed:
            continue
        if employee_id is not None and employee.employee_id != employee_id:
            continue
        for target in targets:
            summary = entitlement_service.summary(db, employee.employee_id, target, leave_year)
            rows.append(
                {
                    "employee_id": employee.employee_id,
                    "employee_code": employee.employee_code,
                    "employee_name": employee.full_name,
                    "leave_type": summary["target_name"],
                    "is_shared_pool": summary["target_kind"] == "POOL",
                    "entitlement_granted": summary["entitlement"],
                    "carry_forward": summary["carry_forward"],
                    "permanent_adjustments": summary["adjustments"],
                    "credits": summary["credits"],
                    "encashed": summary["encashed"],
                    "leave_used": summary["used"],
                    "temporarily_restricted": summary["restricted"],
                    "pending_requests": summary["committed_to_open_requests"],
                    "available_balance": summary["available"],
                    "leave_year": leave_year.year_code,
                }
            )
    return rows


def restriction_report(db: Session, *, leave_year_id: int | None, state: str | None = None,
                       employee_id: int | None = None) -> list[dict]:
    """Temporary restrictions and their releases — never counted as leave taken."""
    from app.services import restriction_service

    rows = restriction_service.list_all(db, leave_year_id=leave_year_id, state=state)
    if employee_id is not None:
        rows = [r for r in rows if r["employee_id"] == employee_id]
    return [
        {
            "restriction_id": r["restriction_id"], "employee_code": r["employee_code"],
            "employee_name": r["employee_name"], "leave_type": r["target_name"], "days": r["days"],
            "start_date": r["start_date"], "end_date": r["end_date"], "reason": r["reason"],
            "state": r["state"], "effective_state": r["effective_state"],
            "released_at": r["released_at"], "cancelled_at": r["cancelled_at"],
            "cancellation_reason": r["cancellation_reason"],
        }
        for r in rows
    ]


#: Ledger rows HR posted by hand, kept apart from the system's own entries.
ADJUSTMENT_ENTRY_TYPES = (
    "MANUAL_ADJUSTMENT", "OPENING_BALANCE_ADJUSTMENT", "ENTITLEMENT_REVISION_ADJUSTMENT",
    "BALANCE_RESET_ADJUSTMENT", "BALANCE_RESET_REVERSAL",
)
CARRY_FORWARD_ENTRY_TYPES = ("CARRY_FORWARD_CREDIT", "CARRY_FORWARD_LAPSE_DEBIT")


def _ledger_rows(db: Session, leave_year_id: int | None, entry_types: tuple[str, ...]) -> list[dict]:
    leave_year = leave_year_dao.find_by_id(db, leave_year_id) if leave_year_id else leave_year_dao.find_current(db)
    if leave_year is None:
        raise AppError("NOT_FOUND", "Leave year not found.", status=404)
    rows = []
    for entry, employee, leave_type in ledger_dao.list_for_leave_year(db, leave_year.leave_year_id):
        if entry.entry_type not in entry_types:
            continue
        rows.append(
            {
                "entry_id": entry.entry_id, "employee_code": employee.employee_code,
                "employee_name": employee.full_name, "leave_type": leave_type.type_name,
                "entry_type": entry.entry_type, "days": float(entry.quantity), "reason": entry.reason,
                "source_reference": entry.source_reference, "recorded_at": entry.created_at,
                "leave_year": leave_year.year_code,
            }
        )
    return rows


def adjustment_report(db: Session, *, leave_year_id: int | None = None) -> list[dict]:
    return _ledger_rows(db, leave_year_id, ADJUSTMENT_ENTRY_TYPES)


def carry_forward_report(db: Session, *, leave_year_id: int | None = None) -> list[dict]:
    return _ledger_rows(db, leave_year_id, CARRY_FORWARD_ENTRY_TYPES)


def archived_leave_type_report(db: Session) -> list[dict]:
    """§16: what was archived, when, and how much history it still carries."""
    from app.services import leave_type_service

    rows = []
    for leave_type in leave_type_dao.list_archived(db):
        policy = leave_type_dao.find_policy(db, leave_type.leave_type_id)
        usage = leave_type_service._usage(db, leave_type.leave_type_id)
        rows.append(
            {
                "leave_type_id": leave_type.leave_type_id, "type_code": leave_type.type_code,
                "type_name": leave_type.type_name,
                "annual_entitlement": float(policy.annual_entitlement) if policy else None,
                "archived_at": leave_type.archived_at, "archived_by": leave_type.archived_by,
                "leave_requests": usage.get("leave_requests", 0),
                "ledger_entries": usage.get("leave_ledger", 0),
            }
        )
    return rows
