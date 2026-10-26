"""Mirrors backend/src/services/teamCapacity.service.js."""
from datetime import date, datetime

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, team_capacity_dao
from app.services import audit_service


def list_for_manager(db: Session, manager_id: int):
    return team_capacity_dao.list_for_manager(db, manager_id)


def list_all(db: Session):
    """Global admin-screen list — list_for_manager is scoped to one manager
    (used at approval-time and the Manager's own view); this is for the
    "all limits" admin table."""
    return team_capacity_dao.list_all(db)


def create_limit(db: Session, manager_employee_id: int, max_concurrent_on_leave: int, effective_from: date, effective_to: date | None, actor_id: int):
    limit = team_capacity_dao.create(
        db, manager_employee_id=manager_employee_id, max_concurrent_on_leave=max_concurrent_on_leave,
        effective_from=effective_from, effective_to=effective_to, created_by=actor_id,
    )
    audit_service.record(
        db, action="TEAM_CAPACITY_LIMIT_CREATED", entity_type="team_capacity_limits", entity_id=limit.capacity_limit_id,
        actor_id=actor_id, new_value={"manager_employee_id": manager_employee_id, "max_concurrent_on_leave": max_concurrent_on_leave},
    )
    return limit


def update_limit(db: Session, capacity_limit_id: int, payload: dict, actor_id: int):
    limit = team_capacity_dao.find_by_id(db, capacity_limit_id)
    if limit is None:
        raise AppError("NOT_FOUND", "Team capacity limit not found.", status=404)
    prior = {"max_concurrent_on_leave": limit.max_concurrent_on_leave, "effective_from": limit.effective_from, "effective_to": limit.effective_to}

    if payload.get("max_concurrent_on_leave") is not None:
        limit.max_concurrent_on_leave = payload["max_concurrent_on_leave"]
    if payload.get("effective_from") is not None:
        limit.effective_from = payload["effective_from"]
    if "effective_to" in payload:
        limit.effective_to = payload["effective_to"] or None
    team_capacity_dao.save(db, limit)

    audit_service.record(
        db, action="TEAM_CAPACITY_LIMIT_UPDATED", entity_type="team_capacity_limits", entity_id=capacity_limit_id,
        actor_id=actor_id, prior_value=prior, new_value=payload,
    )
    return limit


def set_active(db: Session, capacity_limit_id: int, is_active: bool, actor_id: int):
    """No is_active column exists on this model (unlike BlackoutPeriod) —
    "disabled" is represented as effective_to = today; "enabled" clears
    effective_to back to open-ended."""
    limit = team_capacity_dao.find_by_id(db, capacity_limit_id)
    if limit is None:
        raise AppError("NOT_FOUND", "Team capacity limit not found.", status=404)
    limit.effective_to = None if is_active else datetime.now().date()
    team_capacity_dao.save(db, limit)
    audit_service.record(
        db, action="TEAM_CAPACITY_LIMIT_ENABLED" if is_active else "TEAM_CAPACITY_LIMIT_DISABLED",
        entity_type="team_capacity_limits", entity_id=capacity_limit_id, actor_id=actor_id,
    )
    return limit


def remove_limit(db: Session, capacity_limit_id: int, actor_id: int):
    limit = team_capacity_dao.find_by_id(db, capacity_limit_id)
    if limit is None:
        raise AppError("NOT_FOUND", "Team capacity limit not found.", status=404)
    team_capacity_dao.delete(db, limit)
    audit_service.record(db, action="TEAM_CAPACITY_LIMIT_DELETED", entity_type="team_capacity_limits", entity_id=capacity_limit_id, actor_id=actor_id)
    return {"deleted": True}


def assert_within_capacity(db: Session, employee_id: int, start_date: date, end_date: date) -> None:
    """LMS-086: restricts how many of a manager's direct reports may be on
    approved/pending leave at once. Only direct reports count — scoped to one
    manager, not the recursive hierarchy (unlike BR-39's visibility rule)."""
    employee = employee_dao.find_by_id(db, employee_id)
    manager_id = employee.reporting_manager_id if employee else None
    if manager_id is None:
        return  # no manager, no team-capacity concept applies

    active_limit = team_capacity_dao.find_active_for_manager(db, manager_id, start_date, end_date)
    if active_limit is None:
        return

    concurrent_count = team_capacity_dao.count_overlapping_teammates_on_leave(db, manager_id, start_date, end_date)
    if concurrent_count >= active_limit.max_concurrent_on_leave:
        raise AppError(
            "TEAM_CAPACITY_EXCEEDED",
            f"Approving this would exceed the team capacity limit of {active_limit.max_concurrent_on_leave} "
            "concurrent leave-taker(s) under this manager.",
        )
