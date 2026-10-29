"""Approved advance leave: the days beyond the balance are loss of pay, the employee's call.

Balance 3, applied 5, manager approves:
  * 3 days are deducted from the balance (it reaches 0, never negative), 2 days are LOP awaiting the
    employee (lop_status PENDING, lop_decision_deadline = approval + 24 h). The employee is warned.
  * Accept: the 2 days are LOP (CONFIRMED). Withdraw (within 24 h): only the 2 LOP days are dropped,
    the leave is shortened to the 3 covered days (WITHDRAWN). No answer in 24 h: CONFIRMED
    automatically (run_confirmation_sweep). The employee and the manager are told each time.
Rejected advance leave keeps its own rule (withdrawal window, then LOP conversion: decision.py).
"""
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, leave_request_dao, leave_type_dao
from app.models.leave_request import LeaveRequest
from app.services import audit_service, balance_service, business_day_service, notification_service

DECISION_HOURS = 24
PENDING, CONFIRMED, WITHDRAWN = "PENDING", "CONFIRMED", "WITHDRAWN"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def covered_days(db: Session, request) -> float:
    """What the balance can cover for this (still pending) request: the ledger balance minus the
    days committed to the employee's OTHER open requests."""
    balance = balance_service.get_effective_balance(db, request.employee_id, request.leave_type_id, request.leave_year_id)
    available = balance["effective_balance"] + float(request.deducted_days or 0)  # this request is in "committed"
    return max(0.0, min(float(request.deducted_days or 0), available))


def split_on_approval(db: Session, request) -> float:
    """At final approval: the days the ledger is debited with. Days beyond the balance become LOP
    awaiting the employee's decision (the warning goes out here)."""
    total = float(request.deducted_days or 0)
    leave_type = leave_type_dao.find_by_id(db, request.leave_type_id)
    if leave_type is None or not leave_type.is_balance_affecting:
        return total
    covered = covered_days(db, request)
    lop = round(total - covered, 1)
    if lop <= 0:
        return total
    request.lop_days = lop
    request.lop_status = PENDING
    request.lop_decision_deadline = _now() + timedelta(hours=DECISION_HOURS)
    notification_service.notify_in_app(
        db, recipient_id=request.employee_id, template_key="ADVANCE_LOP_WARNING",
        subject=f"Leave approved: {lop:g} day(s) are loss of pay - accept or withdraw within {DECISION_HOURS} h",
        body=(
            f"Your leave {request.start_date:%d %b} to {request.end_date:%d %b %Y} ({total:g} day(s)) was approved. "
            f"{covered:g} day(s) come from your balance; {lop:g} day(s) are beyond it and will be LOSS OF PAY "
            f"(deducted from salary). Accept, or withdraw the {lop:g} LOP day(s) on your Dashboard within "
            f"{DECISION_HOURS} hours. With no answer they are confirmed as loss of pay."
        ),
    )
    return covered


def _own_pending(db: Session, request_id: int, employee_id: int) -> LeaveRequest:
    request = leave_request_dao.find_by_id_for_update(db, request_id)
    if request is None or request.employee_id != employee_id:
        raise AppError("NOT_FOUND", "Leave request not found.", status=404)
    if request.lop_status != PENDING:
        raise AppError("NO_LOP_DECISION", "This leave has no loss-of-pay days waiting for your decision.")
    return request


def _tell_both(db: Session, request, key: str, subject: str, body: str) -> None:
    employee = employee_dao.find_by_id(db, request.employee_id)
    notification_service.notify_in_app(db, recipient_id=request.employee_id, template_key=key, subject=subject, body=body)
    if employee and employee.reporting_manager_id:
        notification_service.notify_in_app(
            db, recipient_id=employee.reporting_manager_id, template_key=key,
            subject=f"{employee.full_name} ({employee.employee_code}): {subject}", body=body,
        )


def _confirm(db: Session, request, actor_id: int | None, how: str) -> None:
    request.lop_status = CONFIRMED
    db.flush()
    days = float(request.lop_days or 0)
    _tell_both(
        db, request, "ADVANCE_LOP_ACCEPTED", f"{days:g} day(s) of loss of pay confirmed",
        f"Leave {request.start_date:%d %b} to {request.end_date:%d %b %Y}: {days:g} day(s) are loss of pay "
        f"({how}). They are listed in Reports > Loss of pay.",
    )
    audit_service.record(
        db, action="ADVANCE_LOP_CONFIRMED", entity_type="leave_requests", entity_id=request.request_id,
        actor_id=actor_id, is_system_actor=actor_id is None, new_value={"lop_days": days, "how": how},
    )


def accept(db: Session, request_id: int, employee_id: int):
    request = _own_pending(db, request_id, employee_id)
    _confirm(db, request, employee_id, "accepted by the employee")
    db.commit()
    return request


def withdraw_lop_days(db: Session, request_id: int, employee_id: int):
    """Within 24 h: drop only the LOP days. The leave keeps the days the balance covers (whole days
    from its start); a leave the balance covered not at all is cancelled."""
    request = _own_pending(db, request_id, employee_id)
    if _now() > _aware(request.lop_decision_deadline):
        raise AppError("LOP_WINDOW_CLOSED", f"The {DECISION_HOURS}-hour window has passed; the loss of pay is confirmed.")
    total = float(request.deducted_days or 0)
    lop = float(request.lop_days or 0)
    covered = round(total - lop, 1)
    keep = math.floor(covered)  # whole days from the start of the leave
    old = {"start_date": str(request.start_date), "end_date": str(request.end_date), "deducted_days": total, "lop_days": lop}

    if keep >= 1:
        breakdown = business_day_service.compute_deduction_breakdown(
            db, request.start_date, request.end_date, False, request.leave_year_id, request.employee_id
        )
        counted = 0
        for day in breakdown["days"]:
            if day["deducted"]:
                counted += 1
                if counted == keep:
                    request.end_date = day["date"]
                    break
        request.deducted_days = keep
    else:
        request.state = "CANCELLED"  # nothing of it was covered: the whole leave is dropped
        request.deducted_days = 0
    if covered - keep > 0:  # e.g. 2.5 covered, 2 kept: the half day goes back to the balance
        balance_service.write_restoration_entry(db, request, covered - keep, employee_id)
    request.lop_status = WITHDRAWN
    request.lop_days = 0
    db.flush()

    shortened = (f"shortened to {request.start_date:%d %b} - {request.end_date:%d %b %Y} ({keep:g} day(s) from the balance)"
                 if keep >= 1 else "cancelled (the balance covered none of it)")
    _tell_both(
        db, request, "ADVANCE_LOP_WITHDRAWN", f"{lop:g} loss-of-pay day(s) withdrawn",
        f"The {lop:g} loss-of-pay day(s) were withdrawn; the leave is {shortened}.",
    )
    audit_service.record(
        db, action="ADVANCE_LOP_WITHDRAWN", entity_type="leave_requests", entity_id=request.request_id,
        actor_id=employee_id, prior_value=old,
        new_value={"end_date": str(request.end_date), "deducted_days": float(request.deducted_days), "state": request.state},
    )
    db.commit()
    return request


def run_confirmation_sweep(db: Session) -> int:
    """No answer within 24 h: the LOP days are confirmed. Returns how many were confirmed."""
    due = list(db.execute(
        select(LeaveRequest).where(LeaveRequest.lop_status == PENDING, LeaveRequest.lop_decision_deadline < _now().replace(tzinfo=None))
    ).scalars())
    for request in due:
        _confirm(db, request, None, f"no answer within {DECISION_HOURS} hours")
    db.commit()
    return len(due)


def unpaid_after_cancellation(request, unelapsed_days: float) -> float:
    """Cancelling approved leave with LOP: the not-yet-taken days drop the LOP days first (they are
    the last days of the leave). Returns how many unelapsed days go back to the balance."""
    lop = float(request.lop_days or 0) if request.lop_status in (PENDING, CONFIRMED) else 0.0
    if lop <= 0:
        return unelapsed_days
    dropped = min(lop, unelapsed_days)
    request.lop_days = round(lop - dropped, 1)
    if request.lop_days <= 0:
        request.lop_status = WITHDRAWN
    return round(unelapsed_days - dropped, 1)
