"""Mirrors backend/src/services/balance.service.js. BR-07: balance is never
stored/mutated directly — always summed from the ledger."""
from sqlalchemy.orm import Session

from app.dao import ledger_dao, leave_request_dao

# BR-10: states whose deducted days count against effective balance before
# approval. CANCELLATION_REQUESTED is included — an approved request pending
# cancellation still has its ledger deduction entry in place and hasn't been
# reversed yet.
OPEN_COMMITMENT_STATES = ("PENDING_MANAGER", "PENDING_HR", "CANCELLATION_REQUESTED")


def get_ledger_balance(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> float:
    return ledger_dao.sum_quantity(db, employee_id, leave_type_id, leave_year_id)


def get_effective_balance(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> dict:
    """BR-10: effective balance = ledger balance - days committed to open requests."""
    ledger_balance = get_ledger_balance(db, employee_id, leave_type_id, leave_year_id)
    committed = leave_request_dao.sum_deducted_days_in_states(
        db, employee_id, leave_type_id, leave_year_id, OPEN_COMMITMENT_STATES
    )
    return {
        "ledger_balance": ledger_balance,
        "committed_to_open_requests": committed,
        "effective_balance": ledger_balance - committed,
    }


def write_deduction_entry(db: Session, request, actor_id: int | None):
    """BR-09: deduction is written only at the moment a request reaches
    APPROVED. Never on submission."""
    return ledger_dao.create_entry(
        db, employee_id=request.employee_id, leave_type_id=request.leave_type_id, leave_year_id=request.leave_year_id,
        entry_type="LEAVE_DEDUCTION_DEBIT", quantity=-abs(float(request.deducted_days or 0)),
        source_reference=f"leave_request:{request.request_id}", actor_id=actor_id, is_system_actor=False,
    )


def write_restoration_entry(db: Session, request, unelapsed_days: float, actor_id: int | None):
    """BR-31: on cancellation approval, restore only the deducted days not yet elapsed."""
    return ledger_dao.create_entry(
        db, employee_id=request.employee_id, leave_type_id=request.leave_type_id, leave_year_id=request.leave_year_id,
        entry_type="CANCELLATION_RESTORATION_CREDIT", quantity=abs(float(unelapsed_days)),
        source_reference=f"leave_request:{request.request_id}", actor_id=actor_id, is_system_actor=False,
    )


def write_manual_adjustment(
    db: Session, employee_id: int, leave_type_id: int, leave_year_id: int, quantity: float, reason: str, actor_id: int | None
):
    """BR-15/BR-54: manual adjustment always requires a reason and is always
    audited/notified by the caller (not this function)."""
    from app.core.exceptions import AppError

    if not (reason or "").strip():
        raise AppError("REASON_REQUIRED", "A reason is required for a manual balance adjustment.")
    return ledger_dao.create_entry(
        db, employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year_id,
        entry_type="MANUAL_ADJUSTMENT", quantity=quantity, source_reference=f"manual_adjustment:{employee_id}",
        actor_id=actor_id, is_system_actor=False, reason=reason,
    )
