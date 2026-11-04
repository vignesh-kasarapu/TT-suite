"""HR balance administration: opening balances, temporary restrictions, the org picture.

Every route here is HR_ADMIN except `GET /my-restrictions`, which an employee uses to see
why days of their own are held back.
"""
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user, require_role
from app.core.responses import created, ok
from app.services import balance_admin_service, restriction_service

router = APIRouter()


def _blank_to_none(value):
    return None if isinstance(value, str) and not value.strip() else value


class OpeningBalanceIn(BaseModel):
    leave_type_id: int | None = None
    pool_id: int | None = None
    opening_balance: float
    reason: str
    employee_ids: list[int] | None = None
    department_id: int | None = None
    leave_year_id: int | None = None

    _blank = field_validator("leave_type_id", "pool_id", "department_id", "leave_year_id", mode="before")(_blank_to_none)


class RestrictionIn(BaseModel):
    employee_id: int
    leave_type_id: int | None = None
    pool_id: int | None = None
    days: float
    start_date: date
    end_date: date
    reason: str

    _blank = field_validator("leave_type_id", "pool_id", mode="before")(_blank_to_none)


class CancelRestrictionIn(BaseModel):
    reason: str


# --- what HR looks at before deciding --------------------------------------------------------


@router.get("/admin/balances/{employee_id}", dependencies=[Depends(require_role("HR_ADMIN"))])
def employee_balances(employee_id: int, leave_year_id: int | None = None, db: Session = Depends(get_db)):
    return ok(balance_admin_service.employee_balances(db, employee_id, leave_year_id))


@router.post("/admin/balances/opening-preview", dependencies=[Depends(require_role("HR_ADMIN"))])
def preview_opening_balances(payload: OpeningBalanceIn, db: Session = Depends(get_db)):
    """Dry run: who would change, by how much. Writes nothing."""
    data = payload.model_dump()
    data.pop("reason", None)
    return ok(balance_admin_service.preview_opening_balances(db, **data))


@router.post("/admin/balances/opening", dependencies=[Depends(require_role("HR_ADMIN"))])
def apply_opening_balances(payload: OpeningBalanceIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(balance_admin_service.apply_opening_balances(db, actor_id=user.employee_id, **payload.model_dump()))


@router.get("/admin/balances-summary", dependencies=[Depends(require_role("HR_ADMIN"))])
def organization_summary(leave_year_id: int | None = None, db: Session = Depends(get_db)):
    return ok(balance_admin_service.organization_summary(db, leave_year_id))


# --- temporary restrictions --------------------------------------------------------------------


@router.get("/admin/restrictions", dependencies=[Depends(require_role("HR_ADMIN"))])
def list_restrictions(leave_year_id: int | None = None, state: str | None = None, employee_id: int | None = None, db: Session = Depends(get_db)):
    if employee_id is not None:
        return ok(restriction_service.list_for_employee(db, employee_id, leave_year_id))
    return ok(restriction_service.list_all(db, leave_year_id=leave_year_id, state=state))


@router.post("/admin/restrictions", status_code=201, dependencies=[Depends(require_role("HR_ADMIN"))])
def create_restriction(payload: RestrictionIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    """Hold days back for a period. They come back on the end date by themselves."""
    return created(restriction_service.create_restriction(db, actor_id=user.employee_id, **payload.model_dump()))


@router.post("/admin/restrictions/{restriction_id}/cancel", dependencies=[Depends(require_role("HR_ADMIN"))])
def cancel_restriction(restriction_id: int, payload: CancelRestrictionIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(restriction_service.cancel_restriction(db, restriction_id, payload.reason, user.employee_id))


@router.post("/admin/restrictions/release-expired", dependencies=[Depends(require_role("HR_ADMIN"))])
def release_expired(db: Session = Depends(get_db)):
    """Same sweep the scheduler runs each night. Safe to run at any time: it only writes
    down releases that have already taken effect."""
    return ok({"released": restriction_service.release_expired(db)})


@router.get("/my-restrictions")
def my_restrictions(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    return ok(restriction_service.list_for_employee(db, user.employee_id))
