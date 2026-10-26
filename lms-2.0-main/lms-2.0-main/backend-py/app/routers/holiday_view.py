"""Thin — mirrors backend/src/routes/holidayView.routes.js +
holidayView.controller.js. Employee-facing holiday calendar + optional-holiday
self-service, distinct from app/routers/holidays.py's HR_ADMIN CRUD mirror of
admin.routes.js."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user, require_role
from app.core.exceptions import AppError
from app.core.responses import created, ok
from app.dao import employee_dao, leave_year_dao
from app.schemas.holiday import HolidayOut
from app.schemas.optional_holiday import OptionalHolidaySummaryOut
from app.services import optional_holiday_service
from app.services.employee.hierarchy import is_in_manager_hierarchy

router = APIRouter()


def _assert_can_act_on_behalf_of(db: Session, actor_id: int, actor_is_hr_admin: bool, target_employee_id: int) -> None:
    if actor_is_hr_admin:
        return
    if not is_in_manager_hierarchy(db, actor_id, target_employee_id):
        raise AppError("PERMISSION_DENIED", "You can only manage optional holidays for your own team.", status=403)


def _summary_out(result: dict) -> dict:
    return OptionalHolidaySummaryOut(
        quota=result["quota"], taken=result["taken"], remaining=result["remaining"],
        eligible_holidays=[
            {**HolidayOut.model_validate(h["holiday"]).model_dump(), "is_selected": h["is_selected"]}
            for h in result["eligible_holidays"]
        ],
    ).model_dump(by_alias=True)


_EMPTY_SUMMARY = {"quota": 0, "taken": 0, "remaining": 0, "eligibleHolidays": []}


@router.get("")
def list_holiday_calendar(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    rows = optional_holiday_service.list_holiday_calendar(db, user.employee_id)
    return ok([HolidayOut.model_validate(r).model_dump() for r in rows])


@router.get("/optional-summary")
def optional_summary(leave_year_id: int | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    if leave_year_id is None:
        current = leave_year_dao.find_current(db)
        leave_year_id = current.leave_year_id if current else None
    if leave_year_id is None:
        return ok(_EMPTY_SUMMARY)
    result = optional_holiday_service.get_optional_holiday_summary(db, user.employee_id, leave_year_id, user.employee.region_id)
    return ok(_summary_out(result))


@router.post("/{holiday_id}/select", status_code=201)
def select_optional(holiday_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    selection = optional_holiday_service.select_optional_holiday(db, user.employee_id, holiday_id)
    return created({"selection_id": selection.selection_id, "holiday_id": selection.holiday_id})


@router.delete("/{holiday_id}/select")
def deselect_optional(holiday_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    return ok(optional_holiday_service.deselect_optional_holiday(db, user.employee_id, holiday_id))


@router.get("/optional-summary/{employee_id}")
def optional_summary_for_employee(employee_id: int, leave_year_id: int | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    _assert_can_act_on_behalf_of(db, user.employee_id, "HR_ADMIN" in user.roles, employee_id)
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    if leave_year_id is None:
        current = leave_year_dao.find_current(db)
        leave_year_id = current.leave_year_id if current else None
    if leave_year_id is None:
        return ok(_EMPTY_SUMMARY)
    result = optional_holiday_service.get_optional_holiday_summary(db, employee_id, leave_year_id, employee.region_id)
    return ok(_summary_out(result))


@router.post("/{holiday_id}/select/{employee_id}", status_code=201)
def assign_optional(holiday_id: int, employee_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    _assert_can_act_on_behalf_of(db, user.employee_id, "HR_ADMIN" in user.roles, employee_id)
    selection = optional_holiday_service.select_optional_holiday(db, employee_id, holiday_id)
    return created({"selection_id": selection.selection_id, "holiday_id": selection.holiday_id})


@router.delete("/{holiday_id}/select/{employee_id}")
def unassign_optional(holiday_id: int, employee_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    _assert_can_act_on_behalf_of(db, user.employee_id, "HR_ADMIN" in user.roles, employee_id)
    return ok(optional_holiday_service.deselect_optional_holiday(db, employee_id, holiday_id))
