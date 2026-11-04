"""Balance reads and the ledger writes that change one (BR-07: never stored, always summed).

Every number here comes from `entitlement_service`, which is the single calculation the
dashboards, Apply, approvals and reports all use. This module stays as the place that
*writes* to the ledger, and it is where a pooled leave type is turned into its pool — a
Sick deduction lands on the Sick/Casual pool, so Casual sees it too.
"""
from sqlalchemy.orm import Session

from app.dao import leave_request_dao, leave_type_dao, leave_year_dao, ledger_dao
from app.services import entitlement_service

#: Kept for the callers that still import it (BR-10).
OPEN_COMMITMENT_STATES = entitlement_service.OPEN_COMMITMENT_STATES


def _target(db: Session, leave_type_id: int):
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        return None
    return entitlement_service.target_for_leave_type(db, leave_type)


def _pool_id(db: Session, leave_type_id: int) -> int | None:
    target = _target(db, leave_type_id)
    return target.pool_id if target is not None else None


def get_ledger_balance(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> float:
    target = _target(db, leave_type_id)
    if target is None:
        return ledger_dao.sum_quantity(db, employee_id, leave_type_id, leave_year_id)
    return ledger_dao.sum_for_target(db, employee_id, leave_year_id, **target.ledger_filter())


def get_balance_summary(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> dict:
    """The full picture for one leave type: entitlement, carry-forward, used, restricted,
    committed and available."""
    leave_year = leave_year_dao.find_by_id(db, leave_year_id)
    target = _target(db, leave_type_id)
    if target is None or leave_year is None:
        return {
            "entitlement": 0.0, "carry_forward": 0.0, "adjustments": 0.0, "credits": 0.0, "encashed": 0.0,
            "used": 0.0, "ledger_balance": 0.0, "committed_to_open_requests": 0.0, "restricted": 0.0,
            "available": 0.0,
        }
    return entitlement_service.summary(db, employee_id, target, leave_year)


def get_effective_balance(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> dict:
    """BR-10, extended: what is left after open requests **and** any temporary restriction
    HR has placed. `effective_balance` keeps its name — every caller already reads it."""
    summary = get_balance_summary(db, employee_id, leave_type_id, leave_year_id)
    return {
        **summary,
        "ledger_balance": summary["ledger_balance"],
        "committed_to_open_requests": summary["committed_to_open_requests"],
        "effective_balance": summary["available"],
    }


def get_days_taken(db: Session, employee_id: int, leave_type, leave_year_id: int) -> float:
    """Days of this type the employee has actually used this leave year.

    Per leave type, never per pool: a shared pool shows one balance but Sick and Casual
    usage are still reported apart (§2.2).

    For the LOP type the total is everything that ends up as loss of pay: leave applied as
    LOP (APPROVED), rejected advance leave the sweep converted (LOP_APPLIED, which also
    rewrites the request onto the LOP type), and the confirmed LOP days of approved advance
    leave, which stay on their original type and so are added separately.
    """
    taken = leave_request_dao.sum_deducted_days_in_states(
        db, employee_id, leave_type.leave_type_id, leave_year_id, ("APPROVED", "LOP_APPLIED")
    )
    if not leave_type.is_balance_affecting:
        taken += leave_request_dao.sum_confirmed_advance_lop_days(db, employee_id, leave_year_id)
    return round(taken, 1)


def write_deduction_entry(db: Session, request, actor_id: int | None, days: float | None = None):
    """BR-09: deduction is written only at the moment a request reaches
    APPROVED. Never on submission. `days`: what the balance covers when part of
    the leave is loss of pay (advance leave), else the whole request."""
    quantity = float(request.deducted_days or 0) if days is None else float(days)
    return ledger_dao.create_entry(
        db, employee_id=request.employee_id, leave_type_id=request.leave_type_id,
        pool_id=_pool_id(db, request.leave_type_id), leave_year_id=request.leave_year_id,
        entry_type="LEAVE_DEDUCTION_DEBIT", quantity=-abs(quantity),
        source_reference=f"leave_request:{request.request_id}", actor_id=actor_id, is_system_actor=False,
    )


def write_restoration_entry(db: Session, request, unelapsed_days: float, actor_id: int | None):
    """BR-31: on cancellation approval, restore only the deducted days not yet elapsed."""
    return ledger_dao.create_entry(
        db, employee_id=request.employee_id, leave_type_id=request.leave_type_id,
        pool_id=_pool_id(db, request.leave_type_id), leave_year_id=request.leave_year_id,
        entry_type="CANCELLATION_RESTORATION_CREDIT", quantity=abs(float(unelapsed_days)),
        source_reference=f"leave_request:{request.request_id}", actor_id=actor_id, is_system_actor=False,
    )


def write_manual_adjustment(
    db: Session, employee_id: int, leave_type_id: int, leave_year_id: int, quantity: float, reason: str,
    actor_id: int | None, entry_type: str = "MANUAL_ADJUSTMENT", source_reference: str | None = None,
):
    """BR-15/BR-54: manual adjustment always requires a reason and is always
    audited/notified by the caller (not this function).

    `entry_type` separates the kinds HR means differently — a permanent adjustment, an
    opening balance, a comp-off credit, an encashment — so a report never has to guess.
    """
    from app.core.exceptions import AppError

    if not (reason or "").strip():
        raise AppError("REASON_REQUIRED", "A reason is required for a manual balance adjustment.")
    return ledger_dao.create_entry(
        db, employee_id=employee_id, leave_type_id=leave_type_id, pool_id=_pool_id(db, leave_type_id),
        leave_year_id=leave_year_id, entry_type=entry_type, quantity=quantity,
        source_reference=source_reference or f"manual_adjustment:{employee_id}",
        actor_id=actor_id, is_system_actor=False, reason=reason,
    )
