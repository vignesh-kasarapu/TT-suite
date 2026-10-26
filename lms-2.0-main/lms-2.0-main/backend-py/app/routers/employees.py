"""Thin — mirrors backend/src/routes/employee.routes.js."""
import csv
import io
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
    DeactivateEmployeeIn,
    RoleAssignmentIn,
    EmployeeOut,
    OnboardEmployeeIn,
    PeerCalendarEntryOut,
    ReassignManagerIn,
    TeamBalanceRowOut,
    TeamCalendarEntryOut,
    UpdateEmployeeDetailsIn,
    UpdateManagerIn,
    UpdateOwnProfileIn,
)
from app.schemas.bulk_import import BulkImportResultOut
from app.schemas.notification_centre import DigestPreferenceIn, DigestPreferenceOut
from app.schemas.r3 import StandingWatcherCreateIn, StandingWatcherOut
from app.services import bulk_import_service, employee as employee_service, notification_centre_service, role_assignment_service, watcher_service
from app.services import leave_request as leave_request_service

BULK_IMPORT_MAX_BYTES = 5 * 1024 * 1024
# Everything the single "Create employee profile" form accepts, so an import is not a
# second-class way to add people. Lookups are by human-readable code/name rather than by
# database id, because nobody hand-writes ids into a spreadsheet.
BULK_IMPORT_FIELDS = (
    "full_name", "work_email", "employee_code", "entra_oid", "date_of_joining", "designation",
    "department_name", "role_code", "management_level_code", "reporting_manager_code",
    "gender", "marital_status", "region_code",
)

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


@router.post("", status_code=201)
def create_employee(payload: OnboardEmployeeIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    employee = employee_service.onboard_employee(db, payload.model_dump(exclude_unset=True), user.employee_id)
    return created(EmployeeOut.from_model(employee).model_dump())


@router.post("/bulk-import")
def bulk_import(file: UploadFile, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    """LMS-019: delimited file, kept in memory only — never written to disk."""
    contents = file.file.read()
    if len(contents) > BULK_IMPORT_MAX_BYTES:
        raise AppError("VALIDATION_ERROR", "File is too large.")

    reader = csv.DictReader(io.StringIO(contents.decode("utf-8-sig")))
    rows = [{k: (v.strip() if isinstance(v, str) else v) for k, v in row.items() if k in BULK_IMPORT_FIELDS} for row in reader]

    result = bulk_import_service.import_employees(db, rows, user.employee_id)
    return ok(BulkImportResultOut(**result).model_dump(by_alias=True))


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


@router.get("/{employee_id}/roles")
def list_roles(employee_id: int, db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    return ok(role_dao.get_role_codes_for_employee(db, employee_id))


@router.post("/{employee_id}/roles", status_code=201)
def assign_role(employee_id: int, payload: RoleAssignmentIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    role_assignment_service.assign_role(db, employee_id, payload.role_code, user.employee_id)
    return created(role_dao.get_role_codes_for_employee(db, employee_id))


@router.delete("/{employee_id}/roles")
def revoke_role(employee_id: int, payload: RoleAssignmentIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    role_assignment_service.revoke_role(db, employee_id, payload.role_code, user.employee_id)
    return ok(role_dao.get_role_codes_for_employee(db, employee_id))


@router.post("/{employee_id}/deactivate")
def deactivate(employee_id: int, payload: DeactivateEmployeeIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = employee_service.deactivate(db, employee_id, payload.last_working_day, user.employee_id)
    return ok({"employee": EmployeeOut.from_model(result["employee"]).model_dump(), "settlement_id": result["settlement"].settlement_id})


@router.post("/{employee_id}/reactivate")
def reactivate(employee_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    employee = employee_service.reactivate(db, employee_id, user.employee_id)
    return ok({"employee": EmployeeOut.from_model(employee).model_dump()})


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
