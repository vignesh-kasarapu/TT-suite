"""TT Suite provisioning (suite contract §3.2): the portal -> LMS user upsert, the
dashboard-click authorize check, and the self-heal used by get_current_user.

Everything goes through LMS's own services (onboarding, role assignment, lifecycle), so
their rules hold — onboarding's opening pro-rata entitlement, LAST_HR_ADMIN, audit rows —
and every change is mirrored into app.app_access with the request's source/actor.

Suite role -> local role grants (EMPLOYEE is implicit for everyone, granted explicitly
as onboarding does):
    employee -> EMPLOYEE                (MANAGER and HR_ADMIN revoked)
    manager  -> EMPLOYEE + MANAGER      (HR_ADMIN revoked)
    admin    -> EMPLOYEE + HR_ADMIN     (an existing MANAGER grant is kept: the suite
                                         role cannot express "admin who also manages")
    None     -> employee deactivated (lifecycle.deactivate), access mirrored to None

A person created from just email + name gets these defaults, for HR to complete later:
    employee_code   "SU-" + last 8 chars of the suite user id (random hex if unknown)
    first/last name split from `name`, else from the email's local part
    date_of_joining today
    designation     "Employee"
    department      "Unassigned" (find-or-create, as the onboarding form does)
    grade / management level / region / reporting manager: none (region none = only
                    org-wide holidays apply)
"""
import re
import secrets
from datetime import date

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from suite_core import identity
from suite_core.constants import is_valid_role
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult

from app.core.exceptions import AppError
from app.dao import employee_dao, leave_year_dao, role_dao
from app.models.employee import Employee
from app.services import role_assignment_service, suite_access_service
from app.services.employee import lifecycle, onboarding
from app.services.suite_access_service import APP, SUITE_ROLE_TO_LOCAL, mirror_context

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
UNASSIGNED_DEPARTMENT = "Unassigned"
DEFAULT_DESIGNATION = "Employee"

# Local grants each suite role must NOT hold (see the module docstring for 'admin').
_REVOKE_FOR: dict[str, tuple[str, ...]] = {
    "employee": ("MANAGER", "HR_ADMIN"),
    "manager": ("HR_ADMIN",),
    "admin": (),
}


def find_local(db: Session, *, email: str, suite_user_id: str | None = None) -> Employee | None:
    if suite_user_id:
        employee = employee_dao.find_by_suite_user_id(db, suite_user_id)
        if employee is not None:
            return employee
    return employee_dao.find_by_work_email(db, email)


def _local_actor_id(db: Session, actor_suite_id: str | None) -> int | None:
    if not actor_suite_id:
        return None
    actor = employee_dao.find_by_suite_user_id(db, actor_suite_id)
    return actor.employee_id if actor is not None else None


def _suite_user_id_for(db: Session, email: str) -> str | None:
    return db.execute(text("SELECT id FROM app.users WHERE email = :e"), {"e": email}).scalar()


def _new_employee_code(db: Session, suite_user_id: str | None) -> str:
    code = f"SU-{suite_user_id[-8:].upper()}" if suite_user_id else f"SU-{secrets.token_hex(4).upper()}"
    while employee_dao.find_by_employee_code(db, code) is not None:
        code = f"SU-{secrets.token_hex(4).upper()}"
    return code


def _assert_ready(db: Session) -> None:
    if role_dao.find_role_by_code(db, "EMPLOYEE") is None or leave_year_dao.find_current(db) is None:
        raise AppError(
            "LMS_NOT_SEEDED", "LMS reference data (roles, current leave year) is not set up yet.", status=409
        )


def _free_entra_oid(db: Session, entra_oid: str | None) -> str | None:
    if entra_oid and employee_dao.find_by_entra_oid(db, entra_oid) is None:
        return entra_oid
    return None


def _create_minimal(
    db: Session, *, email: str, name: str, entra_oid: str | None, role: str, actor_id: int | None, send_invite: bool
) -> Employee:
    _assert_ready(db)
    full_name = " ".join((name or "").split()) or email.split("@")[0]
    payload = {
        "full_name": full_name,
        "work_email": email,
        "employee_code": _new_employee_code(db, _suite_user_id_for(db, email)),
        "date_of_joining": date.today(),
        "designation": DEFAULT_DESIGNATION,
        "department_name": UNASSIGNED_DEPARTMENT,
        "role_code": SUITE_ROLE_TO_LOCAL[role][-1],
        "entra_oid": _free_entra_oid(db, entra_oid),
    }
    return onboarding.onboard_employee(db, payload, actor_id, send_invite=send_invite)


def _apply_role(db: Session, employee: Employee, role: str, actor_id: int | None) -> None:
    held = set(role_dao.get_role_codes_for_employee(db, employee.employee_id))
    to_revoke = [code for code in _REVOKE_FOR[role] if code in held]
    if "HR_ADMIN" in to_revoke:
        role_assignment_service.assert_can_revoke(db, "HR_ADMIN")  # refuse before any write
    for code in SUITE_ROLE_TO_LOCAL[role]:
        role_assignment_service.assign_role(db, employee.employee_id, code, actor_id)
    for code in to_revoke:
        role_assignment_service.revoke_role(db, employee.employee_id, code, actor_id)


def provision(db: Session, req: ProvisionRequest) -> ProvisionResult:
    email = (req.email or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise AppError("VALIDATION_ERROR", "A valid email is required.", status=422)
    if not is_valid_role(APP, req.role):
        raise AppError("INVALID_ROLE", f"'{req.role}' is not an LMS role.", status=422)

    try:
        with mirror_context(source=req.source, actor_suite_id=req.actor_id):
            actor_id = _local_actor_id(db, req.actor_id)
            employee = find_local(db, email=email)

            if req.role is None:
                if employee is not None and employee.is_active:
                    lifecycle.deactivate(db, employee.employee_id, date.today(), actor_id)
                suite_id = identity.mirror_access(
                    db, email=email, name=req.name, app=APP, role=None, source=req.source,
                    actor=req.actor_id, entra_oid=req.entra_oid,
                )
                if employee is not None and employee.suite_user_id != suite_id:
                    employee.suite_user_id = suite_id
                db.commit()
                return ProvisionResult(local_user_id=str(employee.employee_id) if employee else "", role=None)

            if employee is None:
                employee = _create_minimal(
                    db, email=email, name=req.name, entra_oid=req.entra_oid, role=req.role,
                    actor_id=actor_id, send_invite=req.source != "global",
                )
            elif not employee.is_active:
                lifecycle.reactivate(db, employee.employee_id, actor_id)
            _apply_role(db, employee, req.role, actor_id)

            if not employee.entra_oid:
                employee.entra_oid = _free_entra_oid(db, req.entra_oid)
            role = suite_access_service.effective_role(db, employee)
            employee.suite_user_id = identity.mirror_access(
                db, email=employee.work_email, name=req.name or employee.full_name, app=APP, role=role,
                source=req.source, actor=req.actor_id, entra_oid=req.entra_oid,
            )
            db.commit()
            return ProvisionResult(local_user_id=str(employee.employee_id), role=role)
    except Exception:
        db.rollback()
        raise


def ensure_local_employee(
    db: Session, *, suite_user_id: str, email: str, name: str, entra_oid: str | None, app_role: str
) -> Employee:
    """Self-heal (contract §3.1 step 3): find the local employee by suite id, then by
    email; bind the suite id; create one from `app_role` when missing. The suite
    access row already says `app_role`, so the mirror is suppressed here."""
    email = email.strip().lower()
    employee = find_local(db, email=email, suite_user_id=suite_user_id)
    if employee is not None:
        if employee.suite_user_id != suite_user_id:
            employee.suite_user_id = suite_user_id
            db.commit()
        return employee

    try:
        with mirror_context(suppress=True):
            employee = _create_minimal(
                db, email=email, name=name, entra_oid=entra_oid, role=app_role, actor_id=None, send_invite=False
            )
            _apply_role(db, employee, app_role, None)
        employee.suite_user_id = suite_user_id
        db.commit()
        return employee
    except IntegrityError:
        # A concurrent first request created the same employee — use that one.
        db.rollback()
        employee = find_local(db, email=email, suite_user_id=suite_user_id)
        if employee is None:
            raise
        return employee


def authorize(db: Session, req: AuthorizeRequest) -> AuthorizeResult:
    role = identity.access_of(db, req.suite_user_id, APP)
    if role is None:
        return AuthorizeResult(allowed=False, code="NO_APP_ACCESS")
    employee = ensure_local_employee(
        db, suite_user_id=req.suite_user_id, email=req.email, name=req.name, entra_oid=req.entra_oid, app_role=role
    )
    if not employee.is_active:
        return AuthorizeResult(allowed=False, code="LOCAL_USER_INACTIVE")
    return AuthorizeResult(allowed=True, role=suite_access_service.effective_role(db, employee))
