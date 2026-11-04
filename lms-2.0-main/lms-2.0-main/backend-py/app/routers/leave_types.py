"""Thin — leave types, their policy, their shared pools and their archive state. HR_ADMIN only."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.schemas.leave_type import (
    EntitlementPoolIn,
    EntitlementPoolOut,
    EntitlementPoolUpdateIn,
    LeaveAccrualConfigOut,
    LeavePolicyOut,
    LeaveTypeCreateIn,
    LeaveTypeOut,
    LeaveTypePolicyUpdateIn,
    LeaveTypeWithPolicyOut,
)
from app.services import leave_type_service, pool_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


def _to_out(row: dict) -> dict:
    # update_leave_type_policy's result dict has no "accrual_config" key at all
    # (that endpoint never touches accrual config) — .get() rather than [...]
    # so it degrades to null instead of a KeyError.
    return LeaveTypeWithPolicyOut(
        leave_type=LeaveTypeOut.model_validate(row["leave_type"]),
        policy=LeavePolicyOut.model_validate(row["policy"]) if row.get("policy") else None,
        accrual_config=LeaveAccrualConfigOut.model_validate(row["accrual_config"]) if row.get("accrual_config") else None,
        pool=EntitlementPoolOut.model_validate(row["pool"]) if row.get("pool") else None,
    ).model_dump()


@router.get("/leave-types")
def list_leave_types(archived: bool | None = None, db: Session = Depends(get_db)):
    """`archived=true` lists the archived ones instead, for the Archived view."""
    rows = leave_type_service.list_leave_types(db, include_archived=True)
    if archived is True:
        rows = [r for r in rows if r["leave_type"].archived_at is not None]
    elif archived is False:
        rows = [r for r in rows if r["leave_type"].archived_at is None]
    return ok([_to_out(r) for r in rows])


@router.post("/leave-types", status_code=201)
def create_leave_type(payload: LeaveTypeCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    """Creates the type and grants its full entitlement to every active employee at once —
    the response says how many people were credited."""
    result = leave_type_service.create_leave_type(db, payload.model_dump(), user.employee_id)
    return created({**LeaveTypeOut.model_validate(result["leave_type"]).model_dump(), "granted_to": result["granted_to"]})


@router.delete("/leave-types/{leave_type_id}")
def archive_leave_type(leave_type_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    """Archives it (soft delete): off every dashboard and the Apply picker, with all its
    history kept. 409 LEAVE_TYPE_PROTECTED for the built-in types."""
    leave_type_service.archive_leave_type(db, leave_type_id, user.employee_id)
    return ok({"leave_type_id": leave_type_id, "archived": True})


@router.post("/leave-types/{leave_type_id}/restore")
def restore_leave_type(leave_type_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = leave_type_service.restore_leave_type(db, leave_type_id, user.employee_id)
    return ok({**LeaveTypeOut.model_validate(result["leave_type"]).model_dump(), "granted_to": result["granted_to"]})


@router.get("/leave-types/{leave_type_id}/entitlement-preview")
def preview_entitlement_change(leave_type_id: int, annual_entitlement: float, db: Session = Depends(get_db)):
    """What changing this entitlement would mean for everyone, without writing anything."""
    return ok(leave_type_service.preview_entitlement_change(db, leave_type_id, annual_entitlement))


@router.patch("/leave-types/{leave_type_id}/policy")
def update_leave_type_policy(leave_type_id: int, payload: LeaveTypePolicyUpdateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = leave_type_service.update_leave_type_policy(db, leave_type_id, payload.model_dump(exclude_unset=True), user.employee_id)
    return ok(_to_out(result))


# --- shared entitlement pools ---------------------------------------------------------------


@router.get("/entitlement-pools")
def list_pools(include_archived: bool = False, db: Session = Depends(get_db)):
    return ok(pool_service.list_pools(db, include_archived=include_archived))


@router.post("/entitlement-pools", status_code=201)
def create_pool(payload: EntitlementPoolIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return created(pool_service.create_pool(db, payload.model_dump(), user.employee_id))


@router.patch("/entitlement-pools/{pool_id}")
def update_pool(pool_id: int, payload: EntitlementPoolUpdateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(pool_service.update_pool(db, pool_id, payload.model_dump(exclude_unset=True), user.employee_id))


@router.delete("/entitlement-pools/{pool_id}")
def archive_pool(pool_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(pool_service.archive_pool(db, pool_id, user.employee_id))
