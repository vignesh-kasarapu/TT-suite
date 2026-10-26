"""Mirrors backend/src/services/admin.service.js's holiday calendar section
(LMS-028)."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import holiday_dao, leave_request_dao
from app.services import audit_service


def list_holidays(db: Session, leave_year_id: int):
    return holiday_dao.list_by_leave_year(db, leave_year_id)


def add_holiday(db: Session, payload: dict, actor_id: int):
    holiday = holiday_dao.create(
        db,
        holiday_date=payload["holiday_date"],
        holiday_name=payload["holiday_name"],
        leave_year_id=payload["leave_year_id"],
        region_id=payload.get("region_id"),
        is_optional=bool(payload.get("is_optional")),
        created_by=actor_id,
    )

    # 7.3.15: warn where a holiday is added inside an already-approved leave
    # span. Warning only — the holiday is created unconditionally regardless
    # of overlap, and this deliberately checks ALL approved requests org-wide
    # (not scoped to the holiday's region_id), matching Node exactly.
    affected = leave_request_dao.find_approved_overlapping_date(db, payload["holiday_date"])

    audit_service.record(
        db, action="HOLIDAY_ADDED", entity_type="holidays", entity_id=holiday.holiday_id,
        actor_id=actor_id, new_value=payload,
    )
    return {"holiday": holiday, "affected_request_ids": [r.request_id for r in affected]}


def remove_holiday(db: Session, holiday_id: int, actor_id: int):
    holiday = holiday_dao.find_by_id(db, holiday_id)
    if holiday is None:
        raise AppError("NOT_FOUND", "Holiday not found.", status=404)

    prior = {"holiday_date": holiday.holiday_date, "holiday_name": holiday.holiday_name}
    holiday_dao.delete(db, holiday)
    audit_service.record(
        db, action="HOLIDAY_REMOVED", entity_type="holidays", entity_id=holiday_id,
        actor_id=actor_id, prior_value=prior,
    )
    return {"removed": True}
