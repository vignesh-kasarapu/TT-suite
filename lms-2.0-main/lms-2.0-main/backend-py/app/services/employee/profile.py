"""Two deliberately separate, narrow allow-lists — mirrors employee.service.js's
updateEmployeeDetails (HR-only: designation/mgmt-level/gender/marital/region/grade/
department — never reporting manager or role, those have their own dedicated actions)
vs. updateOwnProfile (self-service: only personal/contact fields, nothing
org-controlled reachable here).

TT Suite: neither edits the name or the work email. Both belong to the suite person
(the global admin manages them in the portal); the name is synced from the suite on
every web request (app/core/deps.py)."""
import re

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, leave_type_dao
from app.services import audit_service
from app.services.employee.directory import resolve_department_id

PERSONAL_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def update_employee_details(db: Session, employee_id: int, payload: dict, actor_id: int):
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    if "designation" in payload and not str(payload["designation"] or "").strip():
        raise AppError("VALIDATION_ERROR", "Designation is required.")

    updates: dict = {}
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

    if payload.get("applicable_leave_type_ids") is not None:
        updates["applicable_leave_type_ids"] = set_applicable_leave_types(db, employee_id, payload["applicable_leave_type_ids"])

    employee_dao.update(db, employee, {k: v for k, v in updates.items() if k != "applicable_leave_type_ids"})
    audit_service.record(
        db, action="EMPLOYEE_UPDATED", entity_type="employees", entity_id=employee_id,
        actor_id=actor_id, new_value=updates,
    )
    return employee


def applicable_leave_types(db: Session, employee_id: int) -> list[dict]:
    """Every leave type an employee can apply for, and whether HR left it ticked for this person."""
    if employee_dao.find_by_id(db, employee_id) is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    excluded = leave_type_dao.excluded_type_ids(db, employee_id)
    return [
        {
            "leave_type_id": t.leave_type_id, "type_code": t.type_code, "type_name": t.type_name,
            "applicable": t.leave_type_id not in excluded,
        }
        for t in sorted(leave_type_dao.list_selectable(db), key=lambda t: t.type_name.lower())
    ]


def set_applicable_leave_types(db: Session, employee_id: int, applicable_ids: list[int]) -> list[int]:
    selectable = {t.leave_type_id for t in leave_type_dao.list_selectable(db)}
    chosen = set(applicable_ids)
    unknown = chosen - selectable
    if unknown:
        raise AppError("VALIDATION_ERROR", f"Unknown leave type id(s): {', '.join(map(str, sorted(unknown)))}.")
    leave_type_dao.replace_exclusions(db, employee_id, selectable - chosen)
    return sorted(chosen)


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
