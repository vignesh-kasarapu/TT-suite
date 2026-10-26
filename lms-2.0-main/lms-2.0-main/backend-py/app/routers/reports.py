"""Thin — mirrors backend/src/routes/reports.routes.js +
reports.controller.js."""
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core import export as export_service
from app.core.exceptions import AppError
from app.core.responses import ok
from app.dao import employee_dao, leave_type_dao
from app.schemas.reports import (
    AuditLogRowOut,
    BalanceReportRowOut,
    LeaveTakenRowOut,
    LopPendingRowOut,
    LopReportRowOut,
)
from app.services import reports_service

router = APIRouter()


def _respond(rows, export, name):
    """?export=csv|xlsx streams the same rows as a download instead of JSON."""
    if export is None:
        return ok(rows)
    if export not in export_service.EXPORT_FORMATS:
        raise AppError("VALIDATION_ERROR", "export must be 'csv' or 'xlsx'.")
    return export_service.build_response(rows, export, name)


@router.get("/leave-taken")
def leave_taken(
    from_date: date | None = None, to_date: date | None = None, leave_type_id: int | None = None, state: str | None = None,
    employee_id: int | None = None, department_id: int | None = None, grade_id: int | None = None, manager_id: int | None = None,
    export: str | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN")),
):
    scope = "HR" if "HR_ADMIN" in user.roles else "MANAGER"
    rows = reports_service.leave_taken_report(
        db, from_date=from_date, to_date=to_date, leave_type_id=leave_type_id, state=state, employee_id=employee_id,
        department_id=department_id, grade_id=grade_id, manager_id=manager_id, scope=scope, viewer_id=user.employee_id,
    )
    type_names = {t.leave_type_id: t.type_name for t in leave_type_dao.list_all(db)}
    rows_out = (
        [
            LeaveTakenRowOut(
                request_id=r.request_id, employee_id=e.employee_id, employee_name=e.full_name, employee_code=e.employee_code,
                department_id=e.department_id, grade_id=e.grade_id, leave_type_id=r.leave_type_id,
                leave_type_name=type_names.get(r.leave_type_id, ""), start_date=r.start_date, end_date=r.end_date,
                state=r.state, deducted_days=r.deducted_days,
            ).model_dump()
            for r, e in rows
        ]
    )
    return _respond(rows_out, export, "leave-taken")


@router.get("/lop")
def lop(
    from_date: date | None = None, to_date: date | None = None, employee_id: int | None = None, manager_id: int | None = None,
    export: str | None = None, db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN")),
):
    rows = reports_service.lop_report(db, from_date=from_date, to_date=to_date, employee_id=employee_id, manager_id=manager_id)
    type_names = {t.leave_type_id: t.type_name for t in leave_type_dao.list_all(db)}
    rows_out = (
        [
            LopReportRowOut(
                lop_record_id=lr.lop_record_id, request_id=lr.request_id, employee_id=e.employee_id,
                employee_name=e.full_name, employee_code=e.employee_code,
                prior_leave_type_name=type_names.get(lr.prior_leave_type_id),
                start_date=lr.start_date, end_date=lr.end_date,
                deducted_days=lr.deducted_days, converted_at=lr.converted_at,
            ).model_dump()
            for lr, e in rows
        ]
    )
    return _respond(rows_out, export, "lop")


@router.get("/lop-pending")
def lop_pending(db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    """Days heading for loss of pay but not there yet, with how long the employee has left
    to withdraw. Deliberately a separate endpoint from /lop so the LOP export stays a clean
    list of conversions that actually happened."""
    now = datetime.now(timezone.utc)
    type_names = {t.leave_type_id: t.type_name for t in leave_type_dao.list_all(db)}
    rows = []
    for request in reports_service.lop_pending_report(db):
        employee = employee_dao.find_by_id(db, request.employee_id)
        window_end = request.withdrawal_window_end
        days_left = None
        if window_end is not None:
            if window_end.tzinfo is None:
                window_end = window_end.replace(tzinfo=timezone.utc)
            days_left = max((window_end - now).days, 0)
        rows.append(
            LopPendingRowOut(
                request_id=request.request_id, employee_id=request.employee_id,
                employee_name=employee.full_name if employee else "",
                employee_code=employee.employee_code if employee else "",
                leave_type_name=type_names.get(request.leave_type_id),
                start_date=request.start_date, end_date=request.end_date,
                deducted_days=request.deducted_days,
                withdrawal_window_end=request.withdrawal_window_end,
                days_left_to_withdraw=days_left,
            ).model_dump()
        )
    return ok(rows)


@router.get("/balances")
def balances(leave_year_id: int | None = None, export: str | None = None, db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    rows = reports_service.balances_report(db, leave_year_id)
    rows_out = (
        [
            BalanceReportRowOut(
                entry_id=entry.entry_id, employee_id=e.employee_id, employee_name=e.full_name, employee_code=e.employee_code,
                leave_type_id=lt.leave_type_id, leave_type_name=lt.type_name, entry_type=entry.entry_type,
                quantity=entry.quantity, created_at=entry.created_at,
            ).model_dump()
            for entry, e, lt in rows
        ]
    )
    return _respond(rows_out, export, "balances")


@router.get("/audit-log")
def audit_log(
    actor_id: int | None = None, action: str | None = None, entity_type: str | None = None,
    from_ts: datetime | None = None, to_ts: datetime | None = None,
    export: str | None = None, db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN")),
):
    rows = reports_service.audit_log_report(db, actor_id=actor_id, action=action, entity_type=entity_type, from_ts=from_ts, to_ts=to_ts)
    rows_out = (
        [
            AuditLogRowOut(
                audit_id=log.audit_id, actor_id=log.actor_id, actor_name=actor.full_name if actor else None,
                is_system_actor=log.is_system_actor, action=log.action, entity_type=log.entity_type,
                entity_id=log.entity_id, prior_value=log.prior_value, new_value=log.new_value, timestamp=log.timestamp,
            ).model_dump()
            for log, actor in rows
        ]
    )
    return _respond(rows_out, export, "audit-log")
