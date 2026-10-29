"""Thin — mirrors backend/src/routes/employee.routes.js.

TT Suite: only the global admin (in the portal) creates people and assigns roles. HR here
edits LMS data on existing employees; onboarding, bulk import, role grants/revokes,
deactivation/reactivation and name/work-email changes are no longer exposed — new people
arrive through POST /internal/provision. HR asks the global admin for a role change with
POST /{id}/role-request (suite_core.inbox)."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.avatar_storage import save as save_avatar
from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user, require_role
from app.core.exceptions import AppError
from app.core.responses import created, ok
from app.dao import employee_dao, role_dao
from app.schemas.employee import (
    DashboardOut,
    EmployeeOut,
    PeerCalendarEntryOut,
    ReassignManagerIn,
    RoleChangeRequestIn,
    TeamBalanceRowOut,
    TeamCalendarEntryOut,
    UpdateEmployeeDetailsIn,
    UpdateManagerIn,
    UpdateOwnProfileIn,
)
from app.schemas.notification_centre import DigestPreferenceIn, DigestPreferenceOut
from app.schemas.r3 import StandingWatcherCreateIn, StandingWatcherOut
from app.services import employee as employee_service, notification_centre_service, role_request_service, watcher_service
from app.services import leave_request as leave_request_service

router = APIRouter()


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    result = employee_service.get_dashboard(db, user.employee_id)
    for key in ("pending", "upcoming", "withdrawal_window"):
        result[key] = leave_request_service.with_type_and_approver(db, result[key])
    return ok(DashboardOut(**result).model_dump(by_alias=True))


@router.get("/my-team")
def my_team(db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    rows = employee_service.get_team_balances(db, user.employee_id)
    return ok([TeamBalanceRowOut.from_row(r).model_dump(by_alias=True) for r in rows])


@router.get("/team-calendar")
def team_calendar(
    start_date: date | None = None, end_date: date | None = None,
    db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN")),
):
    start_date = start_date or date.today()
    end_date = end_date or (start_date + timedelta(days=30))
    rows = employee_service.get_team_calendar(db, user.employee_id, start_date, end_date)
    return ok([TeamCalendarEntryOut(**r).model_dump() for r in rows])


@router.get("/peer-calendar")
def peer_calendar(
    start_date: date | None = None, end_date: date | None = None,
    db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user),
):
    start_date = start_date or date.today()
    end_date = end_date or (start_date + timedelta(days=30))
    rows = employee_service.get_peer_calendar(db, user.employee_id, start_date, end_date)
    return ok([PeerCalendarEntryOut(**r).model_dump() for r in rows])


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return ok({"employee": EmployeeOut.from_model(user.employee).model_dump(), "roles": user.roles})


@router.patch("/me")
def update_my_profile(payload: UpdateOwnProfileIn, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    employee = employee_service.update_own_profile(
        db, user.employee_id, payload.model_dump(exclude_unset=True), user.employee_id
    )
    return ok(EmployeeOut.from_model(employee).model_dump())


@router.post("/me/avatar")
def upload_my_avatar(
    # The form field is named `avatar`, matching Node's `avatarUpload.single('avatar')` and
    # what the client actually sends. FastAPI matches the parameter name to the field name,
    # so calling this `file` made every upload fail validation with a 422.
    avatar: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    path = save_avatar(user.employee_id, avatar)
    employee = employee_service.update_own_avatar(db, user.employee_id, path)
    return ok(EmployeeOut.from_model(employee).model_dump())


@router.delete("/me/avatar")
def remove_my_avatar(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    employee = employee_service.remove_own_avatar(db, user.employee_id)
    return ok(EmployeeOut.from_model(employee).model_dump())


@router.get("/me/digest-preference")
def get_my_digest_preference(db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER"))):
    enabled = notification_centre_service.get_my_digest_preference(db, user.employee_id)
    return ok(DigestPreferenceOut(digest_enabled=enabled).model_dump(by_alias=True))


@router.patch("/me/digest-preference")
def set_my_digest_preference(payload: DigestPreferenceIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER"))):
    enabled = notification_centre_service.set_my_digest_preference(db, user.employee_id, payload.digest_enabled)
    return ok(DigestPreferenceOut(digest_enabled=enabled).model_dump(by_alias=True))


@router.get("/{employee_id}/avatar")
def get_avatar(employee_id: int, db: Session = Depends(get_db), _user: CurrentUser = Depends(get_current_user)):
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None or not employee.avatar_path:
        raise AppError("NOT_FOUND", "No profile picture set.", status=404)
    return FileResponse(employee.avatar_path)


@router.get("")
def list_employees(
    search: str | None = None, department_id: int | None = None, grade_id: int | None = None,
    db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN")),
):
    rows = employee_service.list_employees(db, search=search, department_id=department_id, grade_id=grade_id)
    return ok([EmployeeOut.from_model(e).model_dump() for e in rows])


@router.get("/role-requests")
def list_role_requests(db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    """Open role-change requests for LMS (awaiting the global admin), for the "Requested" badge."""
    return ok(role_request_service.pending(db))


@router.get("/watchable")
def watchable_employees(db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    rows = employee_service.list_watchable_employees(db)
    return ok([EmployeeOut.from_model(e).model_dump() for e in rows])


@router.patch("/{employee_id}/manager")
def update_manager(employee_id: int, payload: UpdateManagerIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    employee = employee_service.set_reporting_manager(db, employee_id, payload.manager_id, user.employee_id)
    return ok(EmployeeOut.from_model(employee).model_dump())


@router.patch("/{employee_id}")
def update_details(employee_id: int, payload: UpdateEmployeeDetailsIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    employee = employee_service.update_employee_details(db, employee_id, payload.model_dump(exclude_unset=True), user.employee_id)
    return ok(EmployeeOut.from_model(employee).model_dump())


@router.get("/{employee_id}/leave-types")
def employee_leave_types(employee_id: int, db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(employee_service.applicable_leave_types(db, employee_id))


@router.get("/{employee_id}/roles")
def list_roles(employee_id: int, db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(role_dao.get_role_codes_for_employee(db, employee_id))


@router.post("/{employee_id}/role-request", status_code=201)
def request_role_change(employee_id: int, payload: RoleChangeRequestIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = role_request_service.request_change(
        db, employee_id, payload.role, payload.note, requested_by=user.suite_user_id
    )
    return created(result)


@router.post("/{employee_id}/reassign-manager")
def reassign_manager(employee_id: int, payload: ReassignManagerIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    log = employee_service.reassign_manager(db, employee_id, payload.new_manager_id, payload.transfer_pending_requests, user.employee_id)
    return ok(
        {
            "reassignment_id": log.reassignment_id, "employee_id": log.employee_id, "old_manager_id": log.old_manager_id,
            "new_manager_id": log.new_manager_id, "pending_requests_transferred": log.pending_requests_transferred,
        }
    )


@router.get("/{employee_id}/standing-watchers")
def list_standing_watchers(employee_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    rows = watcher_service.list_standing_watchers(db, employee_id, user.employee_id, "HR_ADMIN" in user.roles)
    return ok([StandingWatcherOut.model_validate(r).model_dump() for r in rows])


@router.post("/{employee_id}/standing-watchers", status_code=201)
def create_standing_watcher(employee_id: int, payload: StandingWatcherCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER", "HR_ADMIN"))):
    row = watcher_service.add_standing_watcher(
        db, employee_id, payload.watcher_employee_id, payload.from_date, payload.to_date, user.employee_id, "HR_ADMIN" in user.roles,
    )
    return created(StandingWatcherOut.model_validate(row).model_dump())
