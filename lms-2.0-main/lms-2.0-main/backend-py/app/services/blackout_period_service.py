"""Mirrors backend/src/services/blackoutPeriod.service.js."""
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import blackout_dao
from app.services import audit_service


def list_blackout_periods(db: Session, include_inactive: bool = False):
    return blackout_dao.list_all(db, include_inactive)


def _assert_valid_date_range(start_date: date | None, end_date: date | None) -> None:
    """LMS-085 follow-up: an inverted range would silently create a blackout
    period that can never match assert_no_blackout_conflict's query — reject
    it outright."""
    if start_date and end_date and end_date < start_date:
        raise AppError("INVALID_DATE_RANGE", "End date cannot be before start date.")


def create_blackout_period(db: Session, name: str, start_date: date, end_date: date, leave_type_id: int | None, actor_id: int):
    _assert_valid_date_range(start_date, end_date)
    period = blackout_dao.create(db, name=name, start_date=start_date, end_date=end_date, leave_type_id=leave_type_id, created_by=actor_id)
    audit_service.record(
        db, action="BLACKOUT_PERIOD_CREATED", entity_type="blackout_periods", entity_id=period.blackout_id,
        actor_id=actor_id, new_value={"name": name, "start_date": start_date, "end_date": end_date, "leave_type_id": leave_type_id},
    )
    return period


def update_blackout_period(db: Session, blackout_id: int, payload: dict, actor_id: int):
    period = blackout_dao.find_by_id(db, blackout_id)
    if period is None:
        raise AppError("NOT_FOUND", "Blackout period not found.", status=404)
    prior = {"name": period.name, "start_date": period.start_date, "end_date": period.end_date, "leave_type_id": period.leave_type_id}

    _assert_valid_date_range(payload.get("start_date", period.start_date), payload.get("end_date", period.end_date))

    if payload.get("name") is not None:
        period.name = payload["name"]
    if payload.get("start_date") is not None:
        period.start_date = payload["start_date"]
    if payload.get("end_date") is not None:
        period.end_date = payload["end_date"]
    if "leave_type_id" in payload:
        period.leave_type_id = payload["leave_type_id"] or None
    blackout_dao.save(db, period)

    audit_service.record(
        db, action="BLACKOUT_PERIOD_UPDATED", entity_type="blackout_periods", entity_id=blackout_id,
        actor_id=actor_id, prior_value=prior, new_value=payload,
    )
    return period


def set_active(db: Session, blackout_id: int, is_active: bool, actor_id: int):
    period = blackout_dao.find_by_id(db, blackout_id)
    if period is None:
        raise AppError("NOT_FOUND", "Blackout period not found.", status=404)
    period.is_active = is_active
    blackout_dao.save(db, period)
    audit_service.record(
        db, action="BLACKOUT_PERIOD_REACTIVATED" if is_active else "BLACKOUT_PERIOD_DEACTIVATED",
        entity_type="blackout_periods", entity_id=blackout_id, actor_id=actor_id,
    )
    return period


def remove_blackout_period(db: Session, blackout_id: int, actor_id: int):
    period = blackout_dao.find_by_id(db, blackout_id)
    if period is None:
        raise AppError("NOT_FOUND", "Blackout period not found.", status=404)
    prior_name = period.name
    blackout_dao.delete(db, period)
    audit_service.record(
        db, action="BLACKOUT_PERIOD_DELETED", entity_type="blackout_periods", entity_id=blackout_id,
        actor_id=actor_id, prior_value={"name": prior_name},
    )
    return {"deleted": True}


def assert_no_blackout_conflict(db: Session, leave_type_id: int, start_date: date, end_date: date) -> None:
    """LMS-085: refuses submission where the span overlaps an active blackout
    period for this leave type (or a type-agnostic one). A hard block, not a
    warning."""
    conflict = blackout_dao.find_conflicting(db, leave_type_id, start_date, end_date)
    if conflict is not None:
        raise AppError(
            "BLACKOUT_PERIOD_CONFLICT",
            f'This span falls within the blackout period "{conflict.name}" '
            f"({conflict.start_date} to {conflict.end_date}). Leave cannot be applied for during this window.",
        )
