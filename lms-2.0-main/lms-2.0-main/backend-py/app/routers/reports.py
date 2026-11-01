"""Thin — mirrors backend/src/routes/reports.routes.js +
reports.controller.js."""
import math
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user, require_role
from app.core import export as export_service
from app.core.exceptions import AppError
from app.core.responses import ok
from app.dao import employee_dao, leave_type_dao, leave_year_dao
from app.schemas.reports import (
    AuditLogRowOut,
    BalanceReportRowOut,
    CompOffReportRowOut,
    EncashmentReportRowOut,
    LeaveTakenRowOut,
    LopPendingRowOut,
    LopReportRowOut,
)
from app.services import reports_service

router = APIRouter()


def _viewer_scope(user: CurrentUser) -> str:
    """HR/Admin sees everyone, a Manager their reporting line, everyone else only
    themselves."""
    if "HR_ADMIN" in user.roles:
        return "HR"
    return "MANAGER" if "MANAGER" in user.roles else "EMPLOYEE"


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
    export: str | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user),
):
    scope = _viewer_scope(user)
    if scope == "EMPLOYEE":
        # No hierarchy to scope by: an employee's report is their own leave and nothing else.
        employee_id = user.employee_id
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
    export: str | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user),
):
    # Loss of pay is everyone's own payroll business, so every signed-in user gets this view.
    # The scope decides whose rows come back: HR/Admin everyone, a Manager their reporting
    # line and themselves, anyone else only their own.
    filters = {
        "from_date": from_date, "to_date": to_date, "employee_id": employee_id, "manager_id": manager_id,
        "scope": _viewer_scope(user), "viewer_id": user.employee_id,
    }
    type_names = {t.leave_type_id: t.type_name for t in leave_type_dao.list_all(db)}
    # Approved leave beyond the balance (the LOP days, the employee's decision), then leave applied
    # as LOP (newest first), then the automatic conversions.
    advance = [
        LopReportRowOut(
            source="ADVANCE", state=r.state, request_id=r.request_id, employee_id=e.employee_id,
            employee_name=e.full_name, employee_code=e.employee_code, leave_type_name=type_names.get(r.leave_type_id),
            start_date=r.start_date, end_date=r.end_date, deducted_days=float(r.lop_days or 0),
            total_days=float(r.deducted_days or 0), balance_days=float(r.deducted_days or 0) - float(r.lop_days or 0),
            lop_status=r.lop_status, lop_decision_deadline=r.lop_decision_deadline, applied_at=r.created_at,
        ).model_dump()
        for r, e in reports_service.lop_advance_report(db, **filters)
    ]
    applied = [
        LopReportRowOut(
            source="APPLIED", state=r.state, request_id=r.request_id, employee_id=e.employee_id,
            employee_name=e.full_name, employee_code=e.employee_code,
            start_date=r.start_date, end_date=r.end_date,
            deducted_days=float(r.deducted_days or 0), applied_at=r.created_at,
        ).model_dump()
        for r, e in reports_service.lop_applied_report(db, **filters)
    ]
    converted = [
        LopReportRowOut(
            source="CONVERTED", state="LOP_APPLIED", lop_record_id=lr.lop_record_id, request_id=lr.request_id,
            employee_id=e.employee_id, employee_name=e.full_name, employee_code=e.employee_code,
            prior_leave_type_name=type_names.get(lr.prior_leave_type_id),
            start_date=lr.start_date, end_date=lr.end_date,
            deducted_days=lr.deducted_days, converted_at=lr.converted_at,
        ).model_dump()
        for lr, e in reports_service.lop_report(db, **filters)
    ]
    return _respond(advance + applied + converted, export, "lop")


@router.get("/lop-pending")
def lop_pending(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """Days heading for loss of pay but not there yet, with how long the employee has left
    to withdraw. Deliberately a separate endpoint from /lop so the LOP export stays a clean
    list of conversions that actually happened."""
    now = datetime.now(timezone.utc)
    type_names = {t.leave_type_id: t.type_name for t in leave_type_dao.list_all(db)}
    rows = []
    for request in reports_service.lop_pending_report(db, _viewer_scope(user), user.employee_id):
        employee = employee_dao.find_by_id(db, request.employee_id)
        window_end = request.withdrawal_window_end
        days_left = None
        if window_end is not None:
            if window_end.tzinfo is None:
                window_end = window_end.replace(tzinfo=timezone.utc)
            days_left = max(math.ceil((window_end - now).total_seconds() / 86400), 0)
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


@router.get("/encashment")
def encashment_report(
    from_date: datetime | None = None, to_date: datetime | None = None, employee_id: int | None = None,
    leave_year_id: int | None = None, status: str | None = None, manager_id: int | None = None,
    export: str | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user),
):
    """Encashment requests and their decisions. Days only — no salary or amount is computed
    anywhere in LMS. Scoped like every other report: HR everyone, a manager their line,
    anyone else their own."""
    rows = reports_service.encashment_report(
        db, from_date=from_date, to_date=to_date, employee_id=employee_id, leave_year_id=leave_year_id,
        status=status, manager_id=manager_id, scope=_viewer_scope(user), viewer_id=user.employee_id,
    )
    type_names = {t.leave_type_id: t.type_name for t in leave_type_dao.list_all(db)}
    year_codes = {y.leave_year_id: y.year_code for y in leave_year_dao.list_all(db)}
    names: dict[int, str] = {}

    def person(employee_id_value: int | None) -> str | None:
        if employee_id_value is None:
            return None
        if employee_id_value not in names:
            found = employee_dao.find_by_id(db, employee_id_value)
            names[employee_id_value] = found.full_name if found else ""
        return names[employee_id_value]

    rows_out = [
        EncashmentReportRowOut(
            encashment_id=r.encashment_id, employee_id=e.employee_id, employee_name=e.full_name,
            employee_code=e.employee_code, leave_type_name=type_names.get(r.leave_type_id),
            leave_year_code=year_codes.get(r.leave_year_id),
            days_requested=float(r.days_encashed),
            days_encashed=float(r.days_encashed) if r.status == "POSTED" else None,
            status=r.status, requested_by_name=person(r.requested_by), requested_at=r.requested_at,
            decided_by_name=person(r.decided_by), decided_at=r.decided_at,
            notes=r.notes, decision_notes=r.decision_notes,
        ).model_dump()
        for r, e in rows
    ]
    return _respond(rows_out, export, "encashment")


@router.get("/comp-off")
def comp_off_report(
    from_date: date | None = None, to_date: date | None = None, employee_id: int | None = None,
    status: str | None = None, manager_id: int | None = None,
    export: str | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user),
):
    """Compensatory-off claims: hours worked, the converted days, and both approval stages."""
    rows = reports_service.comp_off_report(
        db, from_date=from_date, to_date=to_date, employee_id=employee_id, status=status,
        manager_id=manager_id, scope=_viewer_scope(user), viewer_id=user.employee_id,
    )
    year_codes = {y.leave_year_id: y.year_code for y in leave_year_dao.list_all(db)}
    names: dict[int, str] = {}

    def person(employee_id_value: int | None) -> str | None:
        if employee_id_value is None:
            return None
        if employee_id_value not in names:
            found = employee_dao.find_by_id(db, employee_id_value)
            names[employee_id_value] = found.full_name if found else ""
        return names[employee_id_value]

    rows_out = [
        CompOffReportRowOut(
            comp_off_id=r.comp_off_id, employee_id=e.employee_id, employee_name=e.full_name,
            employee_code=e.employee_code, work_date=r.work_date,
            hours_worked=float(r.hours_worked) if r.hours_worked is not None else None,
            days=float(r.hours_or_days), status=r.status, leave_year_code=year_codes.get(r.leave_year_id),
            manager_name=person(r.manager_id), manager_decided_at=r.manager_decided_at,
            hr_name=person(r.hr_id or r.approved_by), hr_decided_at=r.hr_decided_at, notes=r.notes,
        ).model_dump()
        for r, e in rows
    ]
    return _respond(rows_out, export, "comp-off")


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
