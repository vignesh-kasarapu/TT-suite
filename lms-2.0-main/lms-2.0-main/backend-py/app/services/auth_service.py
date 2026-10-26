"""Mirrors backend/src/services/auth.service.js's resolveEmployeeFromEntraClaims
+ the issue-session-token step. The Entra code-exchange/JWKS-verify mechanics
themselves live in app/core/entra.py (infrastructure, not a business rule);
this module is the one business-rule decision in the login path: which
Employee does this Entra identity map to, and are they allowed to sign in.

TT Suite: the web sign-in is the portal's; this Entra path now serves only the mobile
app (bearer token). dev_suite_sign_in is the dev/test-only stand-in for the portal."""
from sqlalchemy import text
from sqlalchemy.orm import Session
from suite_core.constants import SESSION_HOURS_DEFAULT
from suite_core.cookies import hash_session_id, new_session_token

from app.core.exceptions import AppError
from app.core.security import issue_session_token
from app.dao import employee_dao
from app.models.employee import Employee
from app.services import audit_service, suite_access_service


def resolve_employee_from_entra_claims(db: Session, claims: dict) -> Employee:
    """LMS-003. Raises 403 NO_EMPLOYEE_RECORD / EMPLOYEE_DEACTIVATED."""
    employee = employee_dao.find_by_entra_oid(db, claims["oid"])

    if employee is None and claims.get("email"):
        employee = employee_dao.find_by_work_email(db, claims["email"])
        if employee is not None:
            employee_dao.bind_entra_oid(db, employee, claims["oid"])

    if employee is None:
        audit_service.record(
            db,
            action="ACCESS_REFUSED_NO_EMPLOYEE_RECORD",
            entity_type="auth",
            entity_id=claims.get("email") or claims["oid"],
            is_system_actor=True,
            new_value={"oid": claims["oid"], "email": claims.get("email")},
        )
        raise AppError("NO_EMPLOYEE_RECORD", "No employee record matches this account.", status=403)

    if employee.status != "ACTIVE":
        raise AppError("EMPLOYEE_DEACTIVATED", "This employee account has been deactivated.", status=403)

    return employee


def sign_in(db: Session, employee: Employee) -> tuple[str, int]:
    """Issues the session token and audits SIGN_IN. Returns (token, expires_in_seconds)."""
    token, expires_in = issue_session_token(employee.employee_id)
    audit_service.record(
        db,
        action="SIGN_IN",
        entity_type="employees",
        entity_id=employee.employee_id,
        actor_id=employee.employee_id,
    )
    return token, expires_in


def sign_out(db: Session, employee_id: int | None) -> None:
    """LMS-007. Purely an audit entry — session invalidation is the caller
    clearing the cookie/discarding the token; there is no server-side blacklist."""
    if employee_id is not None:
        audit_service.record(
            db,
            action="SIGN_OUT",
            entity_type="employees",
            entity_id=employee_id,
            actor_id=employee_id,
        )


_ACTIVATE_SUITE_USER = text(
    "UPDATE app.users SET status = 'active', last_login_at = now(), updated_at = now() WHERE id = :id"
)
_INSERT_SUITE_SESSION = text(
    "INSERT INTO app.session (id, user_id, expires_at) "
    "VALUES (:id, :uid, now() + make_interval(hours => :hours))"
)


def dev_suite_sign_in(db: Session, *, email: str | None = None, employee_code: str | None = None) -> tuple[Employee, str]:
    """DEV/TEST ONLY (the router refuses it in production): signs an existing employee
    into the TT Suite the way the portal would — makes the suite person active, mirrors
    their LMS access from their local roles, and opens a suite session. Returns
    (employee, raw session token for the cookie)."""
    employee = None
    if email:
        employee = employee_dao.find_by_work_email(db, email)
    elif employee_code:
        employee = employee_dao.find_by_employee_code(db, employee_code)
    if employee is None:
        raise AppError("NO_EMPLOYEE_RECORD", "No employee record matches.", status=404)

    suite_user_id = suite_access_service.sync_employee(db, employee)
    db.execute(_ACTIVATE_SUITE_USER, {"id": suite_user_id})
    token = new_session_token()
    db.execute(
        _INSERT_SUITE_SESSION,
        {"id": hash_session_id(token), "uid": suite_user_id, "hours": SESSION_HOURS_DEFAULT},
    )
    audit_service.record(  # commits the mirror + session together
        db, action="SIGN_IN", entity_type="employees", entity_id=employee.employee_id, actor_id=employee.employee_id,
        new_value={"via": "dev_suite_sign_in"},
    )
    return employee, token
