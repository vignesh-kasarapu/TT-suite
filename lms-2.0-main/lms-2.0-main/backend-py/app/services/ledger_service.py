"""Mirrors backend/src/controllers/ledger.controller.js."""
from sqlalchemy.orm import Session

from app.dao import leave_type_dao, ledger_dao, leave_year_dao
from app.services import audit_service, balance_service, notification_service


def _with_running_balance(db: Session, entries: list) -> list[dict]:
    """A running balance is only meaningful within one leave type, so when a caller asks
    for every type at once each type carries its own counter. The row also names its type,
    which is what lets the screen prove it is showing what the user selected."""
    type_names = {t.leave_type_id: t.type_name for t in leave_type_dao.list_all(db)}
    running: dict[int, float] = {}
    rows = []
    for entry in entries:
        running[entry.leave_type_id] = running.get(entry.leave_type_id, 0.0) + float(entry.quantity)
        rows.append(
            {
                "entry_id": entry.entry_id, "entry_type": entry.entry_type, "quantity": entry.quantity,
                "source_reference": entry.source_reference, "reason": entry.reason, "created_at": entry.created_at,
                "leave_type_id": entry.leave_type_id, "leave_type_name": type_names.get(entry.leave_type_id, ""),
                "leave_year_id": entry.leave_year_id,
                "running_balance": running[entry.leave_type_id],
            }
        )
    return rows


def get_my_ledger(db: Session, employee_id: int, leave_year_id: int | None, leave_type_id: int | None = None) -> list[dict]:
    """LMS-057: an employee's full ledger, every entry with type/quantity/
    running balance/source/timestamp. `leave_type_id` narrows it to one type."""
    leave_year_id = leave_year_id or leave_year_dao.find_current(db).leave_year_id
    entries = ledger_dao.list_for_employee(db, employee_id, leave_year_id, leave_type_id)
    return _with_running_balance(db, entries)


def get_employee_ledger(db: Session, employee_id: int, leave_year_id: int | None, leave_type_id: int | None = None) -> list[dict]:
    """Section 7.3.17: HR/Admin views any employee's full ledger."""
    return get_my_ledger(db, employee_id, leave_year_id, leave_type_id)


def list_all_entries(
    db: Session, *, employee_id, leave_type_id, leave_year_id, entry_type, date_from, date_to, page: int, page_size: int,
):
    page_size = min(page_size, 200)
    return ledger_dao.list_all_paginated(
        db, employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year_id, entry_type=entry_type,
        date_from=date_from, date_to=date_to, page=page, page_size=page_size,
    )


def adjust(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int, quantity: float, reason: str, actor_id: int):
    """LMS-054: HR/Admin manual adjustment — signed quantity + mandatory
    reason, never silent."""
    entry = balance_service.write_manual_adjustment(db, employee_id, leave_type_id, leave_year_id, quantity, reason, actor_id)
    audit_service.record(
        db, action="BALANCE_ADJUSTED", entity_type="leave_ledger", entity_id=entry.entry_id, actor_id=actor_id,
        new_value={"employee_id": employee_id, "leave_type_id": leave_type_id, "quantity": quantity, "reason": reason},
    )
    notification_service.notify(db, recipient_id=employee_id, template_key="BALANCE_ADJUSTED", tokens={"quantity": quantity, "reason": reason})
    db.commit()
    return entry
