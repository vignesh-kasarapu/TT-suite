"""Thin — mirrors the leave-type/policy/accrual section of
backend/src/routes/admin.routes.js. HR_ADMIN only."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.schemas.leave_type import (
    LeaveAccrualConfigOut,
    LeavePolicyOut,
    LeaveTypeCreateIn,
    LeaveTypeOut,
    LeaveTypePolicyUpdateIn,
    LeaveTypeWithPolicyOut,
)
from app.services import leave_type_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


def _to_out(row: dict) -> dict:
    # update_leave_type_policy's result dict has no "accrual_config" key at all
    # (that endpoint never touches accrual config) — .get() rather than [...]
    # so it degrades to null instead of a KeyError.
    return LeaveTypeWithPolicyOut(
        leave_type=LeaveTypeOut.model_validate(row["leave_type"]),
        policy=LeavePolicyOut.model_validate(row["policy"]) if row.get("policy") else None,
        accrual_config=LeaveAccrualConfigOut.model_validate(row["accrual_config"]) if row.get("accrual_config") else None,
    ).model_dump()


@router.get("/leave-types")
def list_leave_types(db: Session = Depends(get_db)):
    rows = leave_type_service.list_leave_types(db)
    return ok([_to_out(r) for r in rows])


@router.post("/leave-types", status_code=201)
def create_leave_type(payload: LeaveTypeCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    leave_type = leave_type_service.create_leave_type(db, payload.model_dump(), user.employee_id)
    return created(LeaveTypeOut.model_validate(leave_type).model_dump())


@router.patch("/leave-types/{leave_type_id}/policy")
def update_leave_type_policy(leave_type_id: int, payload: LeaveTypePolicyUpdateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = leave_type_service.update_leave_type_policy(db, leave_type_id, payload.model_dump(exclude_unset=True), user.employee_id)
    return ok(_to_out(result))
