"""Thin — mirrors the self-approval-permissions section of
backend/src/routes/admin.routes.js. HR_ADMIN only."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.dao import employee_dao
from app.schemas.self_approval import SelfApprovalGrantIn, SelfApprovalGrantOut
from app.services import self_approval_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


def _out(db: Session, row) -> dict:
    """The stored grant, plus the two names the screen shows and what the dates mean. The
    screen read `grantee`/`grantedBy` before anything sent them, so both were blank."""
    grantee = employee_dao.find_by_id(db, row.employee_id)
    granter = employee_dao.find_by_id(db, row.granted_by)
    return {
        **SelfApprovalGrantOut.model_validate(row).model_dump(),
        "duration": self_approval_service.describe(row),
        "grantee": {"employee_id": row.employee_id,
                    "full_name": grantee.full_name if grantee else None,
                    "employee_code": grantee.employee_code if grantee else None},
        "grantedBy": {"employee_id": row.granted_by,
                      "full_name": granter.full_name if granter else None},
    }


@router.get("")
def list_all(db: Session = Depends(get_db)):
    return ok([_out(db, r) for r in self_approval_service.list_all(db)])


@router.post("", status_code=201)
def grant(payload: SelfApprovalGrantIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    """`duration` decides the dates: the ones given, the rest of the leave year, or
    open-ended until the employee is deactivated."""
    row = self_approval_service.grant(
        db, payload.employee_id, user.employee_id, payload.effective_from, payload.effective_to,
        payload.notes, duration=payload.duration,
    )
    return created(_out(db, row))


@router.post("/{grant_id}/revoke")
def revoke(grant_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = self_approval_service.revoke(db, grant_id, user.employee_id)
    return ok(_out(db, row))
