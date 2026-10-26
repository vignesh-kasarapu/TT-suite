"""Thin — mirrors admin.controller.js's `carryForward.trigger`. The only job
with an admin-triggerable endpoint in the Node original; the rest are
cron-only (see app/jobs/scheduler.py)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_role
from app.core.responses import ok
from app.schemas.jobs import CarryForwardTriggerIn
from app.services import carry_forward_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


@router.post("/carry-forward/trigger")
def trigger_carry_forward(payload: CarryForwardTriggerIn, db: Session = Depends(get_db)):
    carry_forward_service.run_year_end_carry_forward(db, payload.leave_year_id)
    return ok({"triggered": True})
