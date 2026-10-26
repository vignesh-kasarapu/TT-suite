"""Mirrors backend/src/services/compOff.service.js (LMS-083)."""
import math
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import comp_off_dao, ledger_dao, leave_type_dao, leave_year_dao
from app.services import audit_service, notification_service


def credit_comp_off(db: Session, employee_id: int, work_date: date, hours_or_days: float, approved_by: int, notes: str | None):
    normalized = float(hours_or_days)
    if not math.isfinite(normalized) or normalized <= 0:
        raise AppError("INVALID_HOURS_OR_DAYS", "hoursOrDays must be a positive number.")
    if work_date is None:
        raise AppError("INVALID_WORK_DATE", "workDate must be a valid date.")

    comp_off_type = leave_type_dao.find_by_code(db, "COMP_OFF")
    if comp_off_type is None:
        raise AppError("COMP_OFF_TYPE_MISSING", "The COMP_OFF leave type is not seeded. Run the seed script or create it first.", status=500)
    leave_year = leave_year_dao.find_current(db)

    if comp_off_dao.find_existing(db, employee_id, work_date) is not None:
        raise AppError("DUPLICATE_COMP_OFF", "A comp-off credit already exists for this employee on this work date.")

    ledger_entry = ledger_dao.create_entry(
        db, employee_id=employee_id, leave_type_id=comp_off_type.leave_type_id, leave_year_id=leave_year.leave_year_id,
        entry_type="MANUAL_ADJUSTMENT", quantity=normalized, source_reference=f"comp_off:{work_date}",
        actor_id=approved_by, reason=notes or f"Compensatory off for work on {work_date}",
    )
    credit = comp_off_dao.create(
        db, employee_id=employee_id, work_date=work_date, hours_or_days=normalized,
        ledger_entry_id=ledger_entry.entry_id, approved_by=approved_by, notes=notes,
    )
    audit_service.record(
        db, action="COMP_OFF_CREDITED", entity_type="compensatory_off_credits", entity_id=credit.comp_off_id,
        actor_id=approved_by, new_value={"employee_id": employee_id, "work_date": work_date, "hours_or_days": normalized},
    )
    try:
        notification_service.notify(db, recipient_id=employee_id, template_key="COMP_OFF_CREDITED", tokens={"hoursOrDays": normalized, "workDate": str(work_date)})
    except Exception:  # noqa: BLE001 — Node swallows this specifically
        pass
    db.commit()
    return credit


def list_for_employee(db: Session, employee_id: int):
    return comp_off_dao.list_for_employee(db, employee_id)
