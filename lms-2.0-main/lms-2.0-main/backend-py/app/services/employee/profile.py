"""What LMS still owns about a person, and what it only mirrors.

LMS owns the employment side: management level, region, grade, department and which leave
types apply. HR edits those here (updateEmployeeDetails — never the reporting manager or a
role, which have their own dedicated actions).

The suite owns the person: name, work email, employee code, job title, phone, personal
email, date of birth, emergency contacts, gender and marital status. LMS keeps copies for
its own screens, reports and mail, and refreshes them from the suite on every request
(app/core/deps.py -> suite_provision_service.sync_personal_details). Editing one of them
here would last until that next request, so both allow-lists refuse them and name the
portal instead."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, leave_type_dao
from app.services import audit_service
from app.services.employee.directory import resolve_department_id


def update_employee_details(db: Session, employee_id: int, payload: dict, actor_id: int):
    """HR edits the employment side of a record. The person's own details — job title,
    gender, marital status and the rest — belong to their TT Suite profile and are re-copied
    on every request, so they are refused here and edited in Users & access instead."""
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    _refuse_suite_owned(payload, {"designation": "job title", "gender": "gender",
                                  "marital_status": "marital status"})

    updates: dict = {}
    if "management_level_id" in payload:
        updates["management_level_id"] = payload["management_level_id"] or None
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


#: Personal details the suite owns since 0008. LMS keeps copies for its own screens and
#: mail, and refreshes them from the suite on every request
#: (suite_provision_service.sync_personal_details), so editing them here would be overwritten
#: on the person's next page load. They are edited once, in the suite profile.
SUITE_OWNED_FIELDS = {
    "phone": "phone number",
    "personal_email": "personal email",
    "date_of_birth": "date of birth",
    "emergency_contact_name": "emergency contact",
    "emergency_contact_phone": "emergency contact number",
    "gender": "gender",
    "marital_status": "marital status",
}


def _refuse_suite_owned(payload: dict, fields: dict[str, str]) -> None:
    """Refuse an edit of anything the suite owns, naming where to change it instead. Writing
    it here would last only until the person's next request, when the suite sync restores
    the suite's value — a silent no-op is worse than a clear refusal."""
    offered = [label for field, label in fields.items() if field in payload]
    if not offered:
        return
    raise AppError(
        "EDIT_IN_SUITE_PROFILE",
        f"{', '.join(offered).capitalize()} {'are' if len(offered) > 1 else 'is'} part of the "
        "TT Suite profile. Change it in the portal (Users & access) and it updates in every app.",
        status=409,
    )


def update_own_profile(db: Session, employee_id: int, payload: dict, actor_id: int):
    """Nothing personal is editable here any more — the suite profile owns it.

    Kept as an endpoint so a client sending the old payload is told where to go instead of
    silently writing a value the next request would overwrite.
    """
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    _refuse_suite_owned(payload, SUITE_OWNED_FIELDS)
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
