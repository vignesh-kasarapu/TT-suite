"""Thin — mirrors backend/src/routes/ledger.routes.js +
ledger.controller.js."""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user, require_role
from app.core.responses import ok
from app.dao import employee_dao
from app.schemas.ledger import AdjustBalanceIn, LedgerAllEntryOut, LedgerEntryOut, LedgerPageOut
from app.services import ledger_service

router = APIRouter()


@router.get("/my")
def my_ledger(leave_year_id: int | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    rows = ledger_service.get_my_ledger(db, user.employee_id, leave_year_id)
    return ok([LedgerEntryOut(**r).model_dump() for r in rows])


@router.get("/employee/{employee_id}")
def employee_ledger(employee_id: int, leave_year_id: int | None = None, db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    rows = ledger_service.get_employee_ledger(db, employee_id, leave_year_id)
    return ok([LedgerEntryOut(**r).model_dump() for r in rows])


@router.get("")
def all_entries(
    employee_id: int | None = None, leave_type_id: int | None = None, leave_year_id: int | None = None,
    entry_type: str | None = None, date_from: datetime | None = None, date_to: datetime | None = None,
    page: int = 1, page_size: int = 50,
    db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN")),
):
    rows, total = ledger_service.list_all_entries(
        db, employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year_id, entry_type=entry_type,
        date_from=date_from, date_to=date_to, page=page, page_size=page_size,
    )
    actors = {}
    for entry, _e, _lt in rows:
        if entry.actor_id and entry.actor_id not in actors:
            actor = employee_dao.find_by_id(db, entry.actor_id)
            actors[entry.actor_id] = actor.full_name if actor else None
    return ok(
        LedgerPageOut(
            total=total,
            page=page,
            page_size=page_size,
            entries=[
                LedgerAllEntryOut(
                    entry_id=entry.entry_id, employee_id=e.employee_id, employee_name=e.full_name, employee_code=e.employee_code,
                    leave_type_id=lt.leave_type_id, leave_type_name=lt.type_name, entry_type=entry.entry_type,
                    quantity=entry.quantity, created_at=entry.created_at,
                    source_reference=entry.source_reference, reason=entry.reason,
                    actor_name=actors.get(entry.actor_id), is_system_actor=entry.is_system_actor,
                )
                for entry, e, lt in rows
            ],
        ).model_dump()
    )


@router.post("/adjust", status_code=201)
def adjust(payload: AdjustBalanceIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    entry = ledger_service.adjust(
        db, payload.employee_id, payload.leave_type_id, payload.leave_year_id, payload.quantity, payload.reason, user.employee_id,
    )
    return ok({"entry_id": entry.entry_id, "quantity": entry.quantity})
