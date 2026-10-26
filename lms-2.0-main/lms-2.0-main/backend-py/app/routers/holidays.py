"""Thin — mirrors the holiday-calendar section of backend/src/routes/admin.routes.js
(LMS-028). HR_ADMIN only."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.schemas.holiday import HolidayAddedOut, HolidayCreateIn, HolidayOut
from app.schemas.optional_holiday import OptionalHolidayUsageOut
from app.services import holiday_service, optional_holiday_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


@router.get("/optional-usage")
def optional_usage(leave_year_id: int, db: Session = Depends(get_db)):
    result = optional_holiday_service.list_optional_holiday_usage(db, leave_year_id)
    return ok(OptionalHolidayUsageOut(**result).model_dump(by_alias=True))


@router.get("")
def list_holidays(leave_year_id: int, db: Session = Depends(get_db)):
    rows = holiday_service.list_holidays(db, leave_year_id)
    return ok([HolidayOut.model_validate(r).model_dump() for r in rows])


@router.post("", status_code=201)
def add_holiday(payload: HolidayCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = holiday_service.add_holiday(db, payload.model_dump(), user.employee_id)
    out = HolidayAddedOut(
        holiday=HolidayOut.model_validate(result["holiday"]), affected_request_ids=result["affected_request_ids"],
    )
    return created(out.model_dump(by_alias=True))


@router.delete("/{holiday_id}")
def remove_holiday(holiday_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = holiday_service.remove_holiday(db, holiday_id, user.employee_id)
    return ok(result)
