"""Mirrors backend/src/services/workingPattern.service.js."""
import json
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import working_pattern_dao
from app.services import audit_service


def list_patterns(db: Session, include_inactive: bool = False):
    """include_inactive is admin-screen-only (mirrors blackoutPeriod.service.js's
    listBlackoutPeriods) — every business-logic caller (assign_pattern's active
    check, get_weekend_override_for_date) must keep seeing active patterns only."""
    return working_pattern_dao.list_patterns(db, include_inactive)


def create_pattern(db: Session, pattern_code: str, pattern_name: str, weekend_days: list, actor_id: int):
    pattern = working_pattern_dao.create_pattern(
        db, pattern_code=pattern_code, pattern_name=pattern_name, weekend_days=json.dumps(weekend_days),
    )
    audit_service.record(
        db, action="WORKING_PATTERN_CREATED", entity_type="working_patterns", entity_id=pattern.working_pattern_id,
        actor_id=actor_id, new_value={"pattern_code": pattern_code, "pattern_name": pattern_name, "weekend_days": weekend_days},
    )
    return pattern


def deactivate_pattern(db: Session, working_pattern_id: int, actor_id: int):
    """Soft-delete: existing WorkingPatternAssignment rows reference this pattern
    by FK, so a hard delete would either cascade-destroy history or fail
    outright — deactivating instead just removes it from future selection.
    Refused outright while any employee (past, present, or future-dated) is
    assigned to it — reassign or end those assignments first, so a
    still-referenced pattern never silently disappears from the list out from
    under someone using it."""
    pattern = working_pattern_dao.find_pattern_by_id(db, working_pattern_id)
    if pattern is None:
        raise AppError("NOT_FOUND", "Working pattern not found.", status=404)

    assignment_count = working_pattern_dao.count_assignments_for_pattern(db, working_pattern_id)
    if assignment_count > 0:
        raise AppError(
            "WORKING_PATTERN_IN_USE",
            f"This pattern is assigned to {assignment_count} employee(s) and cannot be deleted. "
            "Reassign or end those assignments first.",
        )

    pattern.is_active = False
    db.commit()
    audit_service.record(
        db, action="WORKING_PATTERN_DEACTIVATED", entity_type="working_patterns",
        entity_id=working_pattern_id, actor_id=actor_id,
    )
    return {"deactivated": True}


def reactivate_pattern(db: Session, working_pattern_id: int, actor_id: int):
    """Reactivating is always safe — no in-use guard needed (unlike
    deactivate_pattern), since flipping is_active back to true only makes the
    pattern selectable again."""
    pattern = working_pattern_dao.find_pattern_by_id(db, working_pattern_id)
    if pattern is None:
        raise AppError("NOT_FOUND", "Working pattern not found.", status=404)

    pattern.is_active = True
    db.commit()
    audit_service.record(
        db, action="WORKING_PATTERN_REACTIVATED", entity_type="working_patterns",
        entity_id=working_pattern_id, actor_id=actor_id,
    )
    return {"reactivated": True}


def _assert_no_overlap(existing, new_from: date, new_to: date | None):
    """LMS-015: exactly one working pattern is active for an employee on any
    given date — enforced here as an overlap check against the employee's
    existing assignments before the new one is created, not left to a DB
    constraint (a date-range exclusion constraint would need PostgreSQL's
    btree_gist extension, which the shared suite database does not install)."""
    for a in existing:
        starts_before_other_ends = a.effective_to is None or new_from <= a.effective_to
        ends_after_other_starts = new_to is None or new_to >= a.effective_from
        if starts_before_other_ends and ends_after_other_starts:
            raise AppError(
                "WORKING_PATTERN_OVERLAP",
                "This employee already has a working pattern assignment covering part of this date "
                "range. Patterns may not overlap.",
            )


def assign_pattern(db: Session, employee_id: int, working_pattern_id: int, effective_from: date, effective_to: date | None, assigned_by: int):
    pattern = working_pattern_dao.find_pattern_by_id(db, working_pattern_id)
    if pattern is None or not pattern.is_active:
        raise AppError("WORKING_PATTERN_INACTIVE", "This working pattern is not active and cannot be assigned.")

    existing = working_pattern_dao.list_assignments_for_employee(db, employee_id)
    _assert_no_overlap(existing, effective_from, effective_to)

    assignment = working_pattern_dao.create_assignment(
        db, employee_id=employee_id, working_pattern_id=working_pattern_id,
        effective_from=effective_from, effective_to=effective_to, assigned_by=assigned_by,
    )
    audit_service.record(
        db, action="WORKING_PATTERN_ASSIGNED", entity_type="working_pattern_assignments",
        entity_id=assignment.assignment_id, actor_id=assigned_by,
        new_value={"employee_id": employee_id, "working_pattern_id": working_pattern_id,
                   "effective_from": effective_from, "effective_to": effective_to},
    )
    return assignment


def list_assignments(db: Session):
    rows = working_pattern_dao.list_all_assignments(db)
    return [
        {
            "assignment_id": assignment.assignment_id,
            "employee_id": assignment.employee_id,
            "working_pattern_id": assignment.working_pattern_id,
            "effective_from": assignment.effective_from,
            "effective_to": assignment.effective_to,
            "employee_full_name": employee.full_name,
            "employee_code": employee.employee_code,
            "pattern_name": pattern.pattern_name,
            "pattern_code": pattern.pattern_code,
        }
        for assignment, employee, pattern in rows
    ]


def update_assignment(db: Session, assignment_id: int, payload: dict, actor_id: int):
    """HR edits an existing assignment's pattern and/or date range, re-checking
    the same no-overlap rule against this employee's other assignments
    (excluding itself)."""
    assignment = working_pattern_dao.find_assignment_by_id(db, assignment_id)
    if assignment is None:
        raise AppError("NOT_FOUND", "Assignment not found.", status=404)

    working_pattern_id = payload.get("working_pattern_id")
    if working_pattern_id is not None:
        new_pattern = working_pattern_dao.find_pattern_by_id(db, working_pattern_id)
        if new_pattern is None or not new_pattern.is_active:
            raise AppError("WORKING_PATTERN_INACTIVE", "This working pattern is not active and cannot be assigned.")

    new_from = payload.get("effective_from") or assignment.effective_from
    new_to = payload["effective_to"] if "effective_to" in payload else assignment.effective_to

    existing = working_pattern_dao.list_assignments_for_employee(db, assignment.employee_id, exclude_assignment_id=assignment_id)
    _assert_no_overlap(existing, new_from, new_to)

    prior = {
        "working_pattern_id": assignment.working_pattern_id,
        "effective_from": assignment.effective_from,
        "effective_to": assignment.effective_to,
    }
    if working_pattern_id is not None:
        assignment.working_pattern_id = working_pattern_id
    if payload.get("effective_from") is not None:
        assignment.effective_from = payload["effective_from"]
    if "effective_to" in payload:
        assignment.effective_to = payload["effective_to"]
    db.commit()

    audit_service.record(
        db, action="WORKING_PATTERN_ASSIGNMENT_UPDATED", entity_type="working_pattern_assignments",
        entity_id=assignment_id, actor_id=actor_id, prior_value=prior, new_value=payload,
    )
    return assignment


def get_weekend_override_for_date(db: Session, employee_id: int, iso_date: str) -> list | None:
    """Returns the weekend day-code set that applies to this employee on this
    date: their active working pattern if one covers the date, otherwise None
    (caller falls back to the organisation-wide default). Consumed by
    business_day_service (Phase 3)."""
    assignment = working_pattern_dao.find_active_assignment_for_date(db, employee_id, iso_date)
    if assignment is None:
        return None
    pattern = working_pattern_dao.find_pattern_by_id(db, assignment.working_pattern_id)
    return json.loads(pattern.weekend_days)
