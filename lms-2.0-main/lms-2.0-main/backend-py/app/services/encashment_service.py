"""Leave encashment (LMS-084): HR records days an employee wants paid out instead of taken.

Two rules shape the flow:

* **Annual Leave only** — enforced here, not by hiding options in the UI, so a direct API
  call cannot encash Sick, Maternity, Comp-off or LOP.
* **The ledger is debited on approval, never on submission.** A request sits as REQUESTED
  and only *reserves* its days; HR approving it posts the debit, HR rejecting it posts
  nothing. Reserved days are subtracted from what the next request may ask for, so two
  pending requests can never spend the same balance.

No salary, rate or amount is computed anywhere — the record is days, and payroll applies
their own rates (reports.py exposes it).
"""
import math
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, encashment_dao, leave_type_dao, leave_year_dao, ledger_dao
from app.services import audit_service, balance_service, config_service, notification_service

ENCASHABLE_TYPE_CODE = "ANNUAL"
MAX_DAYS_CONFIG_KEY = "encashment.max_days_per_request"

REQUESTED, POSTED, REJECTED = "REQUESTED", "POSTED", "REJECTED"


def max_days_per_request(db: Session) -> int:
    """0 means no limit — the same convention `leave.max_days_per_request` uses. Until HR
    sets a figure, only the employee's own balance caps a request."""
    return config_service.get_or_default(db, MAX_DAYS_CONFIG_KEY, 0)


def reserved_days(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> float:
    """Days already spoken for by requests waiting on HR. They hold no ledger entry yet, so
    nothing else would stop a second request spending the same balance."""
    return encashment_dao.sum_days_in_status(db, employee_id, leave_type_id, leave_year_id, (REQUESTED,))


def encashable_balance(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> dict:
    """What this employee may still ask to encash: the effective balance (ledger minus days
    committed to open leave requests) minus days reserved by pending encashments."""
    balance = balance_service.get_effective_balance(db, employee_id, leave_type_id, leave_year_id)
    reserved = reserved_days(db, employee_id, leave_type_id, leave_year_id)
    return {
        **balance,
        "reserved_by_pending_encashments": reserved,
        "encashable_balance": round(balance["effective_balance"] - reserved, 2),
    }


def _assert_annual_leave(db: Session, leave_type_id: int):
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    if leave_type.type_code.upper() != ENCASHABLE_TYPE_CODE:
        raise AppError(
            "TYPE_NOT_ENCASHABLE",
            f"Only {ENCASHABLE_TYPE_CODE.title()} Leave can be encashed; {leave_type.type_name} cannot.",
        )
    return leave_type


def request_encashment(
    db: Session, employee_id: int, leave_type_id: int, leave_year_id: int, days_encashed: float,
    requested_by: int, notes: str | None,
):
    """Record a request. Nothing is debited here — that is `decide()`'s job after HR approves."""
    days = float(days_encashed)
    if not math.isfinite(days) or days <= 0:
        raise AppError("INVALID_DAYS_ENCASHED", "daysEncashed must be a positive number.")

    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    if not employee.is_active:
        raise AppError("EMPLOYEE_INACTIVE", "Leave cannot be encashed for a deactivated employee.")

    _assert_annual_leave(db, leave_type_id)

    leave_year = leave_year_dao.find_by_id(db, leave_year_id)
    if leave_year is None:
        raise AppError("NOT_FOUND", "Leave year not found.", status=404)
    if leave_year.is_closed:
        raise AppError("CLOSED_YEAR", "This leave year is closed and can no longer be modified.")

    maximum = max_days_per_request(db)
    if maximum and days > maximum:
        raise AppError("ENCASHMENT_LIMIT_EXCEEDED", f"At most {maximum} day(s) can be encashed in one request.")

    # Lock the employee's ledger rows for this type/year, so two requests submitted at the
    # same moment cannot both pass the balance check (BR-07's balance is a SUM, not a row).
    encashment_dao.lock_employee_balance(db, employee_id, leave_type_id, leave_year_id)
    available = encashable_balance(db, employee_id, leave_type_id, leave_year_id)
    if days > available["encashable_balance"]:
        raise AppError(
            "INSUFFICIENT_BALANCE",
            f"Cannot encash {days:g} day(s) — {available['encashable_balance']:g} day(s) available"
            + (
                f" ({available['reserved_by_pending_encashments']:g} reserved by pending requests)"
                if available["reserved_by_pending_encashments"] else ""
            )
            + ".",
        )

    encashment = encashment_dao.create(
        db, employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year_id,
        days_encashed=days, status=REQUESTED, requested_by=requested_by, notes=notes,
    )
    audit_service.record(
        db, action="LEAVE_ENCASHMENT_REQUESTED", entity_type="leave_encashment_requests",
        entity_id=encashment.encashment_id, actor_id=requested_by,
        new_value={"employee_id": employee_id, "leave_type_id": leave_type_id, "days_encashed": days, "status": REQUESTED},
    )
    _notify(db, employee_id, "LEAVE_ENCASHMENT_REQUESTED", f"{days:g} day(s) of leave encashment requested",
            f"A request to encash {days:g} day(s) has been raised and is awaiting HR approval.")
    db.commit()
    return encashment


def decide(db: Session, encashment_id: int, approve: bool, actor_id: int, comments: str | None):
    """HR's decision. Approving posts the one and only debit; rejecting posts nothing."""
    encashment = encashment_dao.find_by_id_for_update(db, encashment_id)
    if encashment is None:
        raise AppError("NOT_FOUND", "Encashment request not found.", status=404)
    if encashment.status != REQUESTED:
        raise AppError("ALREADY_DECIDED", f"This request is already {encashment.status.lower()}.")
    if encashment.employee_id == actor_id:
        raise AppError("SELF_APPROVAL_NOT_ALLOWED", "You cannot decide your own encashment request.")

    prior_status = encashment.status
    encashment.decided_by = actor_id
    encashment.decided_at = datetime.now(timezone.utc)
    encashment.decision_notes = comments

    if not approve:
        encashment.status = REJECTED
        db.flush()
        audit_service.record(
            db, action="LEAVE_ENCASHMENT_REJECTED", entity_type="leave_encashment_requests", entity_id=encashment_id,
            actor_id=actor_id, prior_value={"status": prior_status}, new_value={"status": REJECTED, "comments": comments},
        )
        _notify(db, encashment.employee_id, "LEAVE_ENCASHMENT_REJECTED", "Your leave encashment request was rejected",
                f"Your request to encash {float(encashment.days_encashed):g} day(s) was rejected."
                + (f" Reason: {comments}" if comments else ""))
        db.commit()
        return encashment

    # Re-check the balance at approval time: the employee may have taken leave since.
    encashment_dao.lock_employee_balance(db, encashment.employee_id, encashment.leave_type_id, encashment.leave_year_id)
    days = float(encashment.days_encashed)
    balance = balance_service.get_effective_balance(db, encashment.employee_id, encashment.leave_type_id, encashment.leave_year_id)
    if days > balance["effective_balance"]:
        raise AppError(
            "INSUFFICIENT_BALANCE",
            f"Cannot post {days:g} day(s) — the balance is now only {balance['effective_balance']:g}.",
        )

    ledger_entry = ledger_dao.create_entry(
        db, employee_id=encashment.employee_id, leave_type_id=encashment.leave_type_id,
        leave_year_id=encashment.leave_year_id, entry_type="MANUAL_ADJUSTMENT", quantity=-days,
        # Unique per request: the constant "leave_encashment" it used to carry made two
        # identical posts indistinguishable, so nothing could detect a duplicate.
        source_reference=f"leave_encashment:{encashment.encashment_id}",
        actor_id=actor_id, reason=encashment.notes or "Leave encashment",
    )
    encashment.status = POSTED
    encashment.ledger_entry_id = ledger_entry.entry_id
    db.flush()

    audit_service.record(
        db, action="LEAVE_ENCASHMENT_POSTED", entity_type="leave_encashment_requests", entity_id=encashment_id,
        actor_id=actor_id, prior_value={"status": prior_status},
        new_value={"status": POSTED, "days_encashed": days, "ledger_entry_id": ledger_entry.entry_id, "comments": comments},
    )
    _notify(db, encashment.employee_id, "LEAVE_ENCASHMENT_POSTED", "Your leave encashment was approved",
            f"{days:g} day(s) have been encashed and recorded for payroll.")
    db.commit()
    return encashment


def _notify(db: Session, recipient_id: int, template_key: str, subject: str, body: str) -> None:
    """Templates added after a database was seeded may not exist on it; an in-app fallback
    keeps the employee informed either way, and a notification never fails the decision."""
    try:
        notification_service.notify(db, recipient_id=recipient_id, template_key=template_key, tokens={})
    except Exception:  # noqa: BLE001 — same swallow the rest of the app uses around notify()
        try:
            notification_service.notify_in_app(db, recipient_id=recipient_id, template_key=template_key, subject=subject, body=body)
        except Exception:  # noqa: BLE001
            pass


def list_for_employee(db: Session, employee_id: int):
    return encashment_dao.list_for_employee(db, employee_id)


def list_requests(db: Session, status: str | None = None, employee_id: int | None = None):
    return encashment_dao.list_all(db, status=status, employee_id=employee_id)
