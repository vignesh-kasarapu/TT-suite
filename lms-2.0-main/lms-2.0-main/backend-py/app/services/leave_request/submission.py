"""Mirrors leaveRequest.service.js's submitRequest and submitDraft — LMS-033,
LMS-037-039. attachment_refs is accepted but not yet wired to storage (matches
Node's own gap — attachmentRefs is accepted but never used in submitRequest's
body either; flagged, not silently dropped)."""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, leave_request_dao, leave_type_dao, leave_year_dao
from app.services import audit_service, notification_service
from app.services.leave_request import gates, routing, validation


def submit_request(
    db: Session, employee_id: int, leave_type_id: int, start_date: date, end_date: date,
    is_half_day: bool, half_day_portion: str | None, reason: str, attachment_refs: list | None = None,
):
    employee = employee_dao.find_by_id(db, employee_id)
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    if not leave_type.is_selectable_by_employee:
        raise AppError("TYPE_NOT_SELECTABLE", "This leave type is not selectable by employees.")

    leave_year = leave_year_dao.find_current(db)
    gate_result = gates.run_submission_gates(db, employee, leave_type, start_date, end_date, is_half_day, leave_year)
    breakdown = gate_result["breakdown"]
    validation.assert_medical_attachment(db, leave_type, breakdown["deducted_working_days"], None)

    request = leave_request_dao.create(
        db, employee_id=employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year.leave_year_id,
        start_date=start_date, end_date=end_date, is_half_day=is_half_day, half_day_portion=half_day_portion,
        reason=reason, state="PENDING_MANAGER", deducted_days=breakdown["deducted_working_days"],
        is_advance_leave=gate_result["is_advance_leave"], is_long_leave=gate_result["is_long_leave"],
        application_timestamp=datetime.now(timezone.utc),
    )

    routing.route_and_finalize_submission(db, request, employee, leave_type)

    audit_service.record(
        db, action="LEAVE_REQUEST_SUBMITTED", entity_type="leave_requests", entity_id=request.request_id,
        actor_id=employee_id, new_value={"state": request.state, "deducted_days": request.deducted_days},
    )
    notification_service.notify(
        db, recipient_id=employee_id, template_key="REQUEST_SUBMITTED_CONFIRMATION",
        # The template reads "{{days}} day(s) from {{startDate}} to {{endDate}}" — without
        # these the employee was shown those braces literally.
        tokens={
            "days": request.deducted_days, "startDate": request.start_date.isoformat(),
            "endDate": request.end_date.isoformat(),
        },
        related_request_id=request.request_id,
    )
    db.commit()
    return request


def submit_draft(db: Session, request_id: int, employee_id: int):
    """Promotes an existing DRAFT to PENDING_MANAGER (or straight to APPROVED
    under the self-approval addendum), running exactly the same validation
    and routing gates as a fresh submission — a draft skips those checks only
    until this point, never after."""
    request = leave_request_dao.find_by_id_for_update(db, request_id)
    if request is None or request.employee_id != employee_id:
        raise AppError("NOT_FOUND", "Draft not found.", status=404)
    if request.state != "DRAFT":
        raise AppError("INVALID_STATE", "This request is no longer a draft.")

    employee = employee_dao.find_by_id(db, employee_id)
    leave_type = leave_type_dao.find_by_id(db, request.leave_type_id)
    if not leave_type.is_selectable_by_employee:
        raise AppError("TYPE_NOT_SELECTABLE", "This leave type is not selectable by employees.")

    leave_year = leave_year_dao.find_current(db)
    gate_result = gates.run_submission_gates(
        db, employee, leave_type, request.start_date, request.end_date, request.is_half_day, leave_year,
        exclude_request_id=request_id,
    )
    breakdown = gate_result["breakdown"]
    validation.assert_medical_attachment(db, leave_type, breakdown["deducted_working_days"], request_id)

    request.state = "PENDING_MANAGER"
    request.deducted_days = breakdown["deducted_working_days"]
    request.is_advance_leave = gate_result["is_advance_leave"]
    request.is_long_leave = gate_result["is_long_leave"]
    request.application_timestamp = datetime.now(timezone.utc)
    db.flush()

    routing.route_and_finalize_submission(db, request, employee, leave_type)

    audit_service.record(
        db, action="DRAFT_SUBMITTED", entity_type="leave_requests", entity_id=request.request_id,
        actor_id=employee_id, new_value={"state": request.state, "deducted_days": request.deducted_days},
    )
    notification_service.notify(
        db, recipient_id=employee_id, template_key="REQUEST_SUBMITTED_CONFIRMATION",
        # The template reads "{{days}} day(s) from {{startDate}} to {{endDate}}" — without
        # these the employee was shown those braces literally.
        tokens={
            "days": request.deducted_days, "startDate": request.start_date.isoformat(),
            "endDate": request.end_date.isoformat(),
        },
        related_request_id=request.request_id,
    )
    db.commit()
    return request
