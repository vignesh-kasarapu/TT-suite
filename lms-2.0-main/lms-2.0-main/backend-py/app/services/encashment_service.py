"""Mirrors backend/src/services/encashment.service.js (LMS-084). HR-initiated
conversion of leave balance into a payable record for downstream payroll —
performs no salary calculation itself."""
import math

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import encashment_dao, ledger_dao
from app.services import audit_service, balance_service, notification_service


def request_encashment(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int, days_encashed: float, requested_by: int, notes: str | None):
    normalized_days = float(days_encashed)
    if not math.isfinite(normalized_days) or normalized_days <= 0:
        raise AppError("INVALID_DAYS_ENCASHED", "daysEncashed must be a positive number.")

    balance = balance_service.get_effective_balance(db, employee_id, leave_type_id, leave_year_id)
    if normalized_days > balance["effective_balance"]:
        raise AppError(
            "INSUFFICIENT_BALANCE",
            f"Cannot encash {normalized_days} day(s) — effective balance is only {balance['effective_balance']}.",
        )

    ledger_entry = ledger_dao.create_entry(
        db, employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year_id,
        entry_type="MANUAL_ADJUSTMENT", quantity=-normalized_days, source_reference="leave_encashment",
        actor_id=requested_by, reason=notes or "Leave encashment",
    )
    encashment = encashment_dao.create(
        db, employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year_id,
        days_encashed=normalized_days, ledger_entry_id=ledger_entry.entry_id, status="POSTED",
        requested_by=requested_by, notes=notes,
    )
    audit_service.record(
        db, action="LEAVE_ENCASHMENT_POSTED", entity_type="leave_encashment_requests", entity_id=encashment.encashment_id,
        actor_id=requested_by, new_value={"employee_id": employee_id, "leave_type_id": leave_type_id, "days_encashed": normalized_days},
    )
    try:
        notification_service.notify(db, recipient_id=employee_id, template_key="LEAVE_ENCASHMENT_POSTED", tokens={"daysEncashed": normalized_days})
    except Exception:  # noqa: BLE001 — Node swallows this specifically
        pass
    db.commit()
    return encashment


def list_for_employee(db: Session, employee_id: int):
    return encashment_dao.list_for_employee(db, employee_id)
