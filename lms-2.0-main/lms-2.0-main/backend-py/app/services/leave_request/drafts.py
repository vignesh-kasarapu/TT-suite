"""Mirrors leaveRequest.service.js's saveDraft/updateDraft/discardDraft.
LMS-040: a draft has no effect on balance, effective balance, or overlap
checks until submitted, and may be edited freely."""
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import leave_request_dao, leave_year_dao
from app.services import audit_service


def save_draft(
    db: Session, employee_id: int, leave_type_id: int, start_date: date, end_date: date,
    is_half_day: bool, half_day_portion: str | None, reason: str,
):
    leave_year = leave_year_dao.find_current(db)
    request = leave_request_dao.create(
        db, employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year.leave_year_id,
        start_date=start_date, end_date=end_date, is_half_day=is_half_day, half_day_portion=half_day_portion,
        reason=reason, state="DRAFT",
    )
    audit_service.record(
        db, action="DRAFT_SAVED", entity_type="leave_requests", entity_id=request.request_id, actor_id=employee_id,
    )
    db.commit()
    return request


def update_draft(db: Session, request_id: int, employee_id: int, payload: dict):
    """A draft may be edited freely — only overwrites fields actually supplied."""
    request = leave_request_dao.find_by_id(db, request_id)
    if request is None or request.employee_id != employee_id:
        raise AppError("NOT_FOUND", "Draft not found.", status=404)
    if request.state != "DRAFT":
        raise AppError("INVALID_STATE", "This request is no longer a draft.")

    for field in ("leave_type_id", "start_date", "end_date", "is_half_day", "half_day_portion", "reason"):
        if field in payload and payload[field] is not None:
            setattr(request, field, payload[field])
    db.commit()
    return request


def discard_draft(db: Session, request_id: int, employee_id: int):
    request = leave_request_dao.find_by_id(db, request_id)
    if request is None or request.employee_id != employee_id:
        raise AppError("NOT_FOUND", "Draft not found.", status=404)
    if request.state != "DRAFT":
        raise AppError("INVALID_STATE", "This request is no longer a draft.")

    db.delete(request)
    db.commit()
    return {"discarded": True}
