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
    CompOffRowOut,
    DecisionIn,
    EncashableBalanceOut,
    EncashmentCreateIn,
    EncashmentOut,
    EncashmentRowOut,
    TeamCapacityLimitCreateIn,
    TeamCapacityLimitOut,
    TeamCapacityLimitUpdateIn,
    TeamCapacityLimitWithManagerOut,
)
from app.services import blackout_period_service, calendar_feed_service, comp_off_service, encashment_service, team_capacity_service
from app.dao import comp_off_dao, employee_dao, leave_type_dao
from app.services.employee.hierarchy import get_all_reports_recursive, is_in_manager_hierarchy

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


# --- Leave encashment (LMS-084) — HR/Admin requests and decides, employee views own ---


@router.get("/leave-encashment/encashable-balance")
def encashable_balance(
    employee_id: int, leave_type_id: int, leave_year_id: int,
    db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN")),
):
    """What the screen shows before anyone types a number: the balance, what pending
    requests have already reserved, and the configured per-request maximum."""
    result = encashment_service.encashable_balance(db, employee_id, leave_type_id, leave_year_id)
    return ok(EncashableBalanceOut(
        employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year_id,
        ledger_balance=result["ledger_balance"], effective_balance=result["effective_balance"],
        reserved_by_pending_encashments=result["reserved_by_pending_encashments"],
        encashable_balance=result["encashable_balance"],
        max_days_per_request=encashment_service.max_days_per_request(db),
    ).model_dump())


@router.post("/leave-encashment", status_code=201)
def create_encashment(payload: EncashmentCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    """Raises the request only. The balance is debited when it is approved, never here."""
    row = encashment_service.request_encashment(
        db, payload.employee_id, payload.leave_type_id, payload.leave_year_id, payload.days_encashed, user.employee_id, payload.notes,
    )
    return created(EncashmentOut.model_validate(row).model_dump())


@router.get("/leave-encashment")
def list_encashments(
    status: str | None = None, employee_id: int | None = None,
    db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN")),
):
    rows = encashment_service.list_requests(db, status=status, employee_id=employee_id)
    return ok([_encashment_row(db, r).model_dump() for r in rows])


@router.post("/leave-encashment/{encashment_id}/decision")
def decide_encashment(
    encashment_id: int, payload: DecisionIn, db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_role("HR_ADMIN")),
):
    row = encashment_service.decide(db, encashment_id, payload.approve, user.employee_id, payload.comments)
    return ok(EncashmentOut.model_validate(row).model_dump())


@router.get("/leave-encashment/mine")
def my_encashments(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    rows = encashment_service.list_for_employee(db, user.employee_id)
    return ok([EncashmentOut.model_validate(r).model_dump() for r in rows])


def _encashment_row(db: Session, row) -> EncashmentRowOut:
    employee = employee_dao.find_by_id(db, row.employee_id)
    leave_type = leave_type_dao.find_by_id(db, row.leave_type_id)
    decided_by = employee_dao.find_by_id(db, row.decided_by) if row.decided_by else None
    return EncashmentRowOut(
        **EncashmentOut.model_validate(row).model_dump(),
        employee_name=employee.full_name if employee else "",
        employee_code=employee.employee_code if employee else "",
        leave_type_name=leave_type.type_name if leave_type else None,
        decided_by_name=decided_by.full_name if decided_by else None,
    )


# --- Compensatory off (LMS-083) — employee claims, manager then HR approve ---


@router.post("/comp-off", status_code=201)
def submit_comp_off(payload: CompOffCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """An employee claims their own extra work; a manager or HR may claim on behalf of
    someone in their reporting line. Nothing is credited until HR approves."""
    is_hr_admin = "HR_ADMIN" in user.roles
    is_self = payload.employee_id == user.employee_id
    if not is_self and not is_hr_admin and not is_in_manager_hierarchy(db, user.employee_id, payload.employee_id):
        raise AppError("PERMISSION_DENIED", "You can only raise compensatory off for yourself or your own team.", status=403)

    hours = payload.hours_worked if payload.hours_worked is not None else payload.hours_or_days
    if hours is None:
        raise AppError("INVALID_HOURS", "hoursWorked is required.")
    row = comp_off_service.submit_request(db, payload.employee_id, payload.work_date, hours, user.employee_id, payload.notes)
    return created(CompOffOut.model_validate(row).model_dump())


@router.get("/comp-off/pending")
def pending_comp_off(db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    """Everything this person can actually decide right now.

    HR gets every HR-stage claim **and** the manager-stage claims of their own reports —
    an HR admin who is also somebody's manager would otherwise see an empty queue while a
    claim from their report sat waiting on them.
    """
    report_ids = [r.employee_id for r in get_all_reports_recursive(db, user.employee_id)]
    rows = []
    if "HR_ADMIN" in user.roles:
        rows += comp_off_service.list_requests(db, status=comp_off_service.PENDING_HR)
    if report_ids:
        rows += comp_off_service.list_requests(
            db, status=comp_off_service.PENDING_MANAGER, employee_ids=report_ids,
        )
    # One claim can only be at one stage, so the two lists never overlap; sort them together
    # so the queue reads as one list.
    rows.sort(key=lambda pair: pair[0].work_date, reverse=True)
    return ok([_comp_off_row(row, employee).model_dump() for row, employee in rows])


@router.get("/comp-off")
def list_comp_off(
    status: str | None = None, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN")),
):
    employee_ids = None
    if "HR_ADMIN" not in user.roles:
        employee_ids = [r.employee_id for r in get_all_reports_recursive(db, user.employee_id)]
    rows = comp_off_service.list_requests(db, status=status, employee_ids=employee_ids)
    return ok([_comp_off_row(row, employee).model_dump() for row, employee in rows])


@router.post("/comp-off/{comp_off_id}/decision")
def decide_comp_off(
    comp_off_id: int, payload: DecisionIn, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user),
):
    """The stage is the request's own, not the caller's choice: a manager-stage claim needs
    the employee's manager, an HR-stage claim needs HR/Admin."""
    row = comp_off_dao.find_by_id(db, comp_off_id)
    if row is None:
        raise AppError("NOT_FOUND", "Compensatory-off request not found.", status=404)

    is_hr_admin = "HR_ADMIN" in user.roles
    if row.status == comp_off_service.PENDING_HR:
        if not is_hr_admin:
            raise AppError("PERMISSION_DENIED", "Only HR/Admin can decide at this stage.", status=403)
        as_hr = True
    elif row.status == comp_off_service.PENDING_MANAGER:
        if not is_hr_admin and not is_in_manager_hierarchy(db, user.employee_id, row.employee_id):
            raise AppError("PERMISSION_DENIED", "You can only decide claims from your own team.", status=403)
        as_hr = False
    else:
        raise AppError("ALREADY_DECIDED", f"This request is already {row.status.replace('_', ' ').lower()}.")

    updated = comp_off_service.decide(db, comp_off_id, payload.approve, user.employee_id, payload.comments, as_hr=as_hr)
    return ok(CompOffOut.model_validate(updated).model_dump())


@router.get("/comp-off/mine")
def my_comp_off(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    rows = comp_off_service.list_for_employee(db, user.employee_id)
    return ok([CompOffOut.model_validate(r).model_dump() for r in rows])


def _comp_off_row(row, employee) -> CompOffRowOut:
    return CompOffRowOut(
        **CompOffOut.model_validate(row).model_dump(),
        employee_name=employee.full_name if employee else "",
        employee_code=employee.employee_code if employee else "",
    )


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
