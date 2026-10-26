"""FastAPI dependencies. Two ways in, then the same fresh Employee + roles re-fetch on
EVERY request (LMS-008 — roles are never trusted from a token or the suite):

- Web (TT Suite contract §3.1): the portal's suite session cookie
  (`tt_session` / `__Host-tt_session`) -> suite_core.identity.resolve(db, cookie, "lms").
  No live session -> 401; no LMS access in app.app_access -> 403 NO_APP_ACCESS; the
  local employee is found by suite_user_id, then email (self-healed when missing);
  a deactivated employee -> 403 NO_APP_ACCESS.
- Mobile: `Authorization: Bearer <LMS JWT>` from POST /api/auth/mobile/token (unchanged).

There is no implicit dev bypass any more: local demos and tests sign in through
POST /api/auth/dev/sign-in (refused in production), which creates a real suite session.
"""
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy.orm import Session
from suite_core import identity
from suite_core.constants import session_cookie_name

from app.core.config import settings
from app.core.db import get_db
from app.core.exceptions import AppError
from app.core.security import JWTError, decode_session_token
from app.dao import employee_dao, role_dao
from app.models.employee import Employee
from app.services import suite_provision_service

APP = "lms"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass
class CurrentUser:
    employee_id: int
    employee: Employee
    roles: list[str]
    suite_user_id: str | None = None


def _bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header[7:]
    return None


def suite_cookie(request: Request) -> str | None:
    return request.cookies.get(session_cookie_name(settings.app_profile))


def _employee_from_bearer(db: Session, token: str) -> Employee:
    try:
        employee_id = decode_session_token(token)
    except JWTError as exc:
        raise AppError("SESSION_INVALID", "Session token is invalid or expired.", status=401) from exc
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None or employee.status != "ACTIVE":
        raise AppError("NO_EMPLOYEE_RECORD", "No active employee record for this session.", status=401)
    return employee


def _employee_from_suite_cookie(request: Request, db: Session) -> tuple[Employee, str]:
    ident = identity.resolve(db, suite_cookie(request), APP)
    if ident is None:
        raise AppError("NO_SESSION", "Sign in to continue.", status=401)
    if ident.app_role is None:
        raise AppError("NO_APP_ACCESS", "You do not have access to Leave (LMS).", status=403)
    # CSRF: the cookie is SameSite=Lax; state-changing calls must also carry the header
    # every suite frontend sends (a cross-site form cannot set it).
    if request.method not in SAFE_METHODS and not request.headers.get("x-requested-with"):
        raise AppError("CSRF_REJECTED", "Missing X-Requested-With header.", status=403)

    employee = suite_provision_service.ensure_local_employee(
        db, suite_user_id=ident.user_id, email=ident.email, name=ident.name,
        entra_oid=ident.entra_oid, app_role=ident.app_role,
    )
    if employee.status != "ACTIVE":
        raise AppError("NO_APP_ACCESS", "Your LMS account has been deactivated.", status=403)
    return employee, ident.user_id


def get_current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    token = _bearer_token(request)
    suite_user_id = None
    if token:
        employee = _employee_from_bearer(db, token)
        suite_user_id = employee.suite_user_id
    else:
        employee, suite_user_id = _employee_from_suite_cookie(request, db)

    roles = role_dao.get_role_codes_for_employee(db, employee.employee_id)
    return CurrentUser(employee_id=employee.employee_id, employee=employee, roles=roles, suite_user_id=suite_user_id)


def require_role(*allowed_roles: str):
    def _dependency(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not set(allowed_roles) & set(user.roles):
            raise AppError("PERMISSION_DENIED", "You do not have permission to do this.", status=403)
        return user

    return _dependency
