"""Thin — mirrors the working-pattern section of backend/src/routes/admin.routes.js,
delegated in Node to workingPattern.service.js. HR_ADMIN only."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.schemas.working_pattern import (
    WorkingPatternAssignmentCreateIn,
    WorkingPatternAssignmentDetailOut,
    WorkingPatternAssignmentOut,
    WorkingPatternAssignmentUpdateIn,
    WorkingPatternCreateIn,
    WorkingPatternOut,
)
from app.services import working_pattern_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


@router.get("/working-patterns")
def list_patterns(include_inactive: bool = False, db: Session = Depends(get_db)):
    rows = working_pattern_service.list_patterns(db, include_inactive)
    return ok([WorkingPatternOut.model_validate(r).model_dump() for r in rows])


@router.post("/working-patterns", status_code=201)
def create_pattern(payload: WorkingPatternCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = working_pattern_service.create_pattern(db, payload.pattern_code, payload.pattern_name, payload.weekend_days, user.employee_id)
    return created(WorkingPatternOut.model_validate(row).model_dump())


@router.post("/working-patterns/{working_pattern_id}/deactivate")
def deactivate_pattern(working_pattern_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(working_pattern_service.deactivate_pattern(db, working_pattern_id, user.employee_id))


@router.post("/working-patterns/{working_pattern_id}/reactivate")
def reactivate_pattern(working_pattern_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(working_pattern_service.reactivate_pattern(db, working_pattern_id, user.employee_id))


@router.post("/working-pattern-assignments", status_code=201)
def assign_pattern(payload: WorkingPatternAssignmentCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = working_pattern_service.assign_pattern(
        db, payload.employee_id, payload.working_pattern_id, payload.effective_from, payload.effective_to, user.employee_id,
    )
    return created(WorkingPatternAssignmentOut.model_validate(row).model_dump())


@router.get("/working-pattern-assignments")
def list_assignments(db: Session = Depends(get_db)):
    rows = working_pattern_service.list_assignments(db)
    return ok([WorkingPatternAssignmentDetailOut.model_validate(r).model_dump() for r in rows])


@router.patch("/working-pattern-assignments/{assignment_id}")
def update_assignment(assignment_id: int, payload: WorkingPatternAssignmentUpdateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = working_pattern_service.update_assignment(db, assignment_id, payload.model_dump(exclude_unset=True), user.employee_id)
    return ok(WorkingPatternAssignmentOut.model_validate(row).model_dump())
