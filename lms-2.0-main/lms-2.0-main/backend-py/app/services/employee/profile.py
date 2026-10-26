"""Two deliberately separate, narrow allow-lists — mirrors employee.service.js's
updateEmployeeDetails (HR-only: name/designation/mgmt-level/gender/marital/region/
department — never reporting manager or role, those have their own dedicated
actions) vs. updateOwnProfile (self-service: only personal/contact fields,
nothing org-controlled reachable here)."""
import re

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao
from app.services import audit_service, suite_access_service
from app.services.employee.directory import resolve_department_id

PERSONAL_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
WORK_EMAIL_RE = PERSONAL_EMAIL_RE


def update_employee_details(db: Session, employee_id: int, payload: dict, actor_id: int):
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    if "full_name" in payload and not str(payload["full_name"] or "").strip():
        raise AppError("VALIDATION_ERROR", "Full name is required.")
    if "designation" in payload and not str(payload["designation"] or "").strip():
        raise AppError("VALIDATION_ERROR", "Designation is required.")

    # The work email is the sign-in identity Entra is matched against, so it is unique and
    # must never be blanked — unlike the optional fields below, an empty value is rejected
    # rather than stored as NULL.
    new_work_email = None
    if "work_email" in payload:
        new_work_email = str(payload["work_email"] or "").strip().lower()
        if not new_work_email:
            raise AppError("VALIDATION_ERROR", "Work email is required.")
        if not WORK_EMAIL_RE.match(new_work_email):
            raise AppError("VALIDATION_ERROR", "Enter a valid work email address.")
        existing = employee_dao.find_by_work_email(db, new_work_email)
        if existing is not None and existing.employee_id != employee.employee_id:
            raise AppError("DUPLICATE_WORK_EMAIL", "Another employee already uses that work email.")

    updates: dict = {}
    if new_work_email is not None and new_work_email != employee.work_email:
        updates["work_email"] = new_work_email
    if "full_name" in payload:
        parts = payload["full_name"].strip().split(" ")
        updates["first_name"] = parts[0]
        updates["last_name"] = " ".join(parts[1:]) or None
    if "designation" in payload:
        updates["designation"] = payload["designation"].strip()
    if "management_level_id" in payload:
        updates["management_level_id"] = payload["management_level_id"] or None
    if "gender" in payload:
        updates["gender"] = payload["gender"] or None
    if "marital_status" in payload:
        updates["marital_status"] = payload["marital_status"] or None
    if "region_id" in payload:
        updates["region_id"] = payload["region_id"] or None
    if "grade_id" in payload:
        updates["grade_id"] = payload["grade_id"] or None
    if (payload.get("department_name") or "").strip():
        updates["department_id"] = resolve_department_id(db, payload["department_name"])

    old_work_email = employee.work_email
    employee_dao.update(db, employee, updates)
    # TT Suite: the suite identity is the email. A changed work email moves this
    # employee's LMS access to the (possibly new, invited) suite person with the new
    # email; a name change refreshes the suite person's empty name.
    if "work_email" in updates:
        suite_access_service.revoke_email(db, old_work_email, actor_employee_id=actor_id)
        employee.suite_user_id = None
    if "work_email" in updates or "first_name" in updates:
        suite_access_service.sync_employee(db, employee, actor_employee_id=actor_id)
    audit_service.record(  # commits the mirror with the audit row
        db, action="EMPLOYEE_UPDATED", entity_type="employees", entity_id=employee_id,
        actor_id=actor_id, new_value=updates,
    )
    return employee


def update_own_profile(db: Session, employee_id: int, payload: dict, actor_id: int):
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    if payload.get("personal_email") and not PERSONAL_EMAIL_RE.match(str(payload["personal_email"]).strip()):
        raise AppError("VALIDATION_ERROR", "Enter a valid personal email address.")

    updates: dict = {}
    for field in ("phone", "personal_email", "date_of_birth", "emergency_contact_name", "emergency_contact_phone"):
        if field in payload:
            value = payload[field]
            updates[field] = value.strip() if isinstance(value, str) and value.strip() else (value or None)
    if "gender" in payload:
        updates["gender"] = payload["gender"] or None
    if "marital_status" in payload:
        updates["marital_status"] = (payload["marital_status"] or "").strip() or None

    employee_dao.update(db, employee, updates)
    audit_service.record(
        db, action="PROFILE_UPDATED", entity_type="employees", entity_id=employee_id,
        actor_id=actor_id, new_value=updates,
    )
    return employee


def update_own_avatar(db: Session, employee_id: int, new_avatar_path: str):
    import os

    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    previous_path = employee.avatar_path
    employee_dao.update(db, employee, {"avatar_path": new_avatar_path})

    if previous_path and previous_path != new_avatar_path:
        try:
            os.remove(previous_path)
        except OSError:
            pass  # best-effort cleanup, never block the response on it

    return employee


def remove_own_avatar(db: Session, employee_id: int):
    """Clears the picture and falls back to the initials avatar. Idempotent — removing
    a picture that is already gone is a success, not a 404."""
    import os

    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    previous_path = employee.avatar_path
    if previous_path:
        employee_dao.update(db, employee, {"avatar_path": None})
        try:
            os.remove(previous_path)
        except OSError:
            pass  # the row is what matters; a stale file on disk is not worth failing on

    return employee
