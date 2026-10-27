"""TT Suite: HR asks the global admin for a role change (suite_core.inbox).

Only the global admin assigns LMS roles (in the portal, applied through
POST /internal/provision). HR picks a suite role — employee | manager | admin — or None
("no access") for an existing employee; the request is recorded in app.role_request and
every global admin gets an inbox message. Nothing changes locally until it is approved.
"""
from sqlalchemy.orm import Session
from suite_core import inbox
from suite_core.constants import is_valid_role
from suite_core.identity import SuiteAccessError

from app.core.exceptions import AppError
from app.dao import employee_dao
from app.services.suite_access_service import APP


def request_change(db: Session, employee_id: int, role: str | None, note: str, *, requested_by: str | None) -> dict:
    role = (role or "").strip().lower() or None
    if not is_valid_role(APP, role):
        raise AppError("INVALID_ROLE", f"'{role}' is not an LMS role.", status=422)
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    try:
        request_id = inbox.request_role_change(
            db, app=APP, email=employee.work_email, role=role, requested_by=requested_by, note=note or "",
        )
    except SuiteAccessError as exc:
        db.rollback()
        raise AppError("NOT_IN_SUITE", "This person is not in the TT Suite yet; ask the global admin to add them.",
                       status=409) from exc
    db.commit()
    return {"request_id": request_id, "employee_id": employee_id, "role": role}


def pending(db: Session) -> list[dict]:
    """Open LMS requests, each with the local employee id (matched by work email) when known."""
    rows = inbox.pending_requests(db, APP)
    by_email = {}
    for row in rows:
        email = row["email"]
        if email not in by_email:
            employee = employee_dao.find_by_work_email(db, email)
            by_email[email] = employee.employee_id if employee is not None else None
        row["employee_id"] = by_email[email]
    return rows
