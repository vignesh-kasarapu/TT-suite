"""Leave-year configuration and the next-year transition. HR_ADMIN only.

Creating the next year is deliberately a separate, explicit act from closing the current
one: `POST /admin/leave-years` records the year HR approved, and the existing
`POST /admin/carry-forward/trigger` closes the old one and makes the new one current.
"""
from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.dao import leave_year_dao
from app.services import leave_year_service

router = APIRouter()


class LeaveYearCreateIn(BaseModel):
    start_date: date
    end_date: date


def _year(row) -> dict | None:
    if row is None:
        return None
    return {
        "leave_year_id": row.leave_year_id, "year_code": row.year_code,
        "start_date": str(row.start_date), "end_date": str(row.end_date),
        "is_current": row.is_current, "is_closed": row.is_closed,
    }


@router.get("/leave-years")
def list_leave_years(db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    state = leave_year_service.get_configuration(db)
    proposed = None
    if state["transition_required"] and state["current"] is not None:
        # What the configured start would give for the year after the current one — shown as
        # a suggestion only. The dates are still typed in and approved by HR, because a
        # change of year shape needs a transition period nobody can infer.
        day_after = state["current"].end_date
        start, end, code = leave_year_service.bounds_from(state["configured_start_month_day"], day_after)
        proposed = {"start_date": str(start), "end_date": str(end), "year_code": code}

    return ok({
        "years": [_year(y) for y in leave_year_dao.list_all(db)],
        "current": _year(state["current"]),
        "next": _year(state["next"]),
        "configured_start_month_day": state["configured_start_month_day"],
        "pending_change": state["pending_change"],
        "transition_required": state["transition_required"],
        "proposed_next": proposed,
    })


@router.post("/leave-years", status_code=201)
def create_leave_year(
    payload: LeaveYearCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN")),
):
    row = leave_year_service.create_next_leave_year(db, payload.start_date, payload.end_date, user.employee_id)
    db.commit()
    return created(_year(row))
