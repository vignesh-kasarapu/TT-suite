"""Thin — mirrors backend/src/routes/r3.routes.js + r3.controller.js.
BlackoutPeriod + TeamCapacityLimit CRUD (full CRUD beyond the assert-only
gates already used by Phase 3), leave encashment, compensatory off."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user, require_role
from app.core.exceptions import AppError
from app.core.responses import created, ok
from app.core.config import settings
from app.schemas.r3 import (
    ActiveIn,
    BlackoutPeriodCreateIn,
    BlackoutPeriodOut,
    BlackoutPeriodUpdateIn,
    CalendarFeedSubscribeIn,
    CalendarFeedSubscriptionOut,
    CompOffCreateIn,
    CompOffOut,
    EncashmentCreateIn,
    EncashmentOut,
    TeamCapacityLimitCreateIn,
    TeamCapacityLimitOut,
    TeamCapacityLimitUpdateIn,
    TeamCapacityLimitWithManagerOut,
)
from app.services import blackout_period_service, calendar_feed_service, comp_off_service, encashment_service, team_capacity_service
from app.services.employee.hierarchy import is_in_manager_hierarchy

router = APIRouter()

# --- Blackout periods (LMS-085) — everyone can read, HR/Admin manages ---


@router.get("/blackout-periods")
def list_blackout_periods(include_inactive: bool = False, db: Session = Depends(get_db), _user: CurrentUser = Depends(get_current_user)):
    rows = blackout_period_service.list_blackout_periods(db, include_inactive)
    return ok([BlackoutPeriodOut.model_validate(r).model_dump() for r in rows])


@router.post("/blackout-periods", status_code=201)
def create_blackout_period(payload: BlackoutPeriodCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = blackout_period_service.create_blackout_period(db, payload.name, payload.start_date, payload.end_date, payload.leave_type_id, user.employee_id)
    return created(BlackoutPeriodOut.model_validate(row).model_dump())


@router.patch("/blackout-periods/{blackout_id}")
def update_blackout_period(blackout_id: int, payload: BlackoutPeriodUpdateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = blackout_period_service.update_blackout_period(db, blackout_id, payload.model_dump(exclude_unset=True), user.employee_id)
    return ok(BlackoutPeriodOut.model_validate(row).model_dump())


@router.patch("/blackout-periods/{blackout_id}/active")
def set_blackout_active(blackout_id: int, payload: ActiveIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = blackout_period_service.set_active(db, blackout_id, payload.is_active, user.employee_id)
    return ok(BlackoutPeriodOut.model_validate(row).model_dump())


@router.post("/blackout-periods/{blackout_id}/deactivate")
def deactivate_blackout(blackout_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = blackout_period_service.set_active(db, blackout_id, False, user.employee_id)
    return ok(BlackoutPeriodOut.model_validate(row).model_dump())


@router.delete("/blackout-periods/{blackout_id}")
def remove_blackout_period(blackout_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(blackout_period_service.remove_blackout_period(db, blackout_id, user.employee_id))


# --- Team capacity limits (LMS-086) — HR/Admin only, Manager sees own ---


@router.get("/team-capacity-limits")
def list_all_capacity_limits(db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    rows = team_capacity_service.list_all(db)
    return ok(
        [TeamCapacityLimitWithManagerOut(**TeamCapacityLimitOut.model_validate(limit).model_dump(), manager_name=e.full_name).model_dump() for limit, e in rows]
    )


@router.get("/team-capacity-limits/{manager_id}")
def list_capacity_limits_for_manager(manager_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN", "MANAGER"))):
    is_hr_admin = "HR_ADMIN" in user.roles
    if not is_hr_admin and manager_id != user.employee_id:
        raise AppError("PERMISSION_DENIED", "You can only view your own team capacity limits.", status=403)
    rows = team_capacity_service.list_for_manager(db, manager_id)
    return ok([TeamCapacityLimitOut.model_validate(r).model_dump() for r in rows])


@router.post("/team-capacity-limits", status_code=201)
def create_capacity_limit(payload: TeamCapacityLimitCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = team_capacity_service.create_limit(db, payload.manager_employee_id, payload.max_concurrent_on_leave, payload.effective_from, payload.effective_to, user.employee_id)
    return created(TeamCapacityLimitOut.model_validate(row).model_dump())


@router.patch("/team-capacity-limits/{capacity_limit_id}")
def update_capacity_limit(capacity_limit_id: int, payload: TeamCapacityLimitUpdateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = team_capacity_service.update_limit(db, capacity_limit_id, payload.model_dump(exclude_unset=True), user.employee_id)
    return ok(TeamCapacityLimitOut.model_validate(row).model_dump())


@router.patch("/team-capacity-limits/{capacity_limit_id}/active")
def set_capacity_limit_active(capacity_limit_id: int, payload: ActiveIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = team_capacity_service.set_active(db, capacity_limit_id, payload.is_active, user.employee_id)
    return ok(TeamCapacityLimitOut.model_validate(row).model_dump())


@router.delete("/team-capacity-limits/{capacity_limit_id}")
def remove_capacity_limit(capacity_limit_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(team_capacity_service.remove_limit(db, capacity_limit_id, user.employee_id))


# --- Leave encashment (LMS-084) — HR/Admin initiates, employee views own ---


@router.post("/leave-encashment", status_code=201)
def create_encashment(payload: EncashmentCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = encashment_service.request_encashment(
        db, payload.employee_id, payload.leave_type_id, payload.leave_year_id, payload.days_encashed, user.employee_id, payload.notes,
    )
    return created(EncashmentOut.model_validate(row).model_dump())


@router.get("/leave-encashment/mine")
def my_encashments(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    rows = encashment_service.list_for_employee(db, user.employee_id)
    return ok([EncashmentOut.model_validate(r).model_dump() for r in rows])


# --- Compensatory off (LMS-083) — Manager/HR credits, employee views own ---


@router.post("/comp-off", status_code=201)
def credit_comp_off(payload: CompOffCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    is_hr_admin = "HR_ADMIN" in user.roles
    if not is_hr_admin and not is_in_manager_hierarchy(db, user.employee_id, payload.employee_id):
        raise AppError("PERMISSION_DENIED", "You can only credit compensatory off for your own team.", status=403)
    row = comp_off_service.credit_comp_off(db, payload.employee_id, payload.work_date, payload.hours_or_days, user.employee_id, payload.notes)
    return created(CompOffOut.model_validate(row).model_dump())


@router.get("/comp-off/mine")
def my_comp_off(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    rows = comp_off_service.list_for_employee(db, user.employee_id)
    return ok([CompOffOut.model_validate(r).model_dump() for r in rows])


# --- Calendar feed (LMS-082) — session-authenticated management endpoints ---


@router.post("/calendar-feed/subscribe", status_code=201)
def subscribe_calendar_feed(payload: CalendarFeedSubscribeIn, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    token = calendar_feed_service.create_subscription(db, user.employee_id, payload.scope)
    return created({"token": token, "url": f"{(settings.public_base_url or settings.app_base_url).rstrip('/')}/api/calendar-feed/{token}.ics"})


@router.get("/calendar-feed/mine")
def my_calendar_feed_subscriptions(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    rows = calendar_feed_service.list_subscriptions(db, user.employee_id)
    return ok([CalendarFeedSubscriptionOut.model_validate(r).model_dump() for r in rows])


@router.post("/calendar-feed/{subscription_id}/revoke")
def revoke_calendar_feed_subscription(subscription_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    row = calendar_feed_service.revoke_subscription(db, subscription_id, user.employee_id)
    return ok(CalendarFeedSubscriptionOut.model_validate(row).model_dump())
