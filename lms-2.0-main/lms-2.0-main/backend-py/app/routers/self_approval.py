"""Thin — mirrors the self-approval-permissions section of
backend/src/routes/admin.routes.js. HR_ADMIN only."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.schemas.self_approval import SelfApprovalGrantIn, SelfApprovalGrantOut
from app.services import self_approval_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


@router.get("")
def list_all(db: Session = Depends(get_db)):
    rows = self_approval_service.list_all(db)
    return ok([SelfApprovalGrantOut.model_validate(r).model_dump() for r in rows])


@router.post("", status_code=201)
def grant(payload: SelfApprovalGrantIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = self_approval_service.grant(db, payload.employee_id, user.employee_id, payload.effective_from, payload.effective_to, payload.notes)
    return created(SelfApprovalGrantOut.model_validate(row).model_dump())


@router.post("/{grant_id}/revoke")
def revoke(grant_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = self_approval_service.revoke(db, grant_id, user.employee_id)
    return ok(SelfApprovalGrantOut.model_validate(row).model_dump())
