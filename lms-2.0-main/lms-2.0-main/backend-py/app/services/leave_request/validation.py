"""Mirrors leaveRequest.service.js's validation helpers (top of file)."""
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import leave_request_attachment_dao, leave_request_dao, leave_type_dao
from app.services import config_service


def assert_valid_date_span(start_date: date, end_date: date) -> None:
    """A request's end date can never be before its start date — an inverted
    span would silently walk backwards (and off the start of the intended
    range) rather than throwing, so this must be checked explicitly before any
    deduction math runs."""
    if end_date < start_date:
        raise AppError("INVALID_DATE_RANGE", "End date cannot be before start date.")


def is_gender_eligible(leave_type, employee) -> bool:
    """A type restricted to one gender is only refused for someone recorded as the other.

    An employee with no gender on record stays eligible: denying leave on the basis of a
    field nobody has filled in would be worse than letting the request through, and the
    approver still sees it.
    """
    required = (getattr(leave_type, "gender_eligibility", None) or "ALL").upper()
    if required == "ALL":
        return True
    employee_gender = (getattr(employee, "gender", None) or "").upper()
    if not employee_gender:
        return True
    return employee_gender == required


def assert_gender_eligible(leave_type, employee) -> None:
    if not is_gender_eligible(leave_type, employee):
        raise AppError(
            "TYPE_NOT_ELIGIBLE",
            f"{leave_type.type_name} is not available for your profile.",
        )


def assert_applicable(db: Session, leave_type, employee) -> None:
    """HR can mark a leave type as not applicable to a person (Edit employee)."""
    if leave_type.leave_type_id in leave_type_dao.excluded_type_ids(db, employee.employee_id):
        raise AppError(
            "TYPE_NOT_APPLICABLE",
            f"{leave_type.type_name} does not apply to you. Ask HR if you think this is wrong.",
        )


def assert_valid_half_day(start_date: date, end_date: date, is_half_day: bool) -> None:
    """BR-34: a half-day only ever means half of a single day — a multi-day
    span can't be "half"."""
    if is_half_day and start_date != end_date:
        raise AppError("INVALID_HALF_DAY", "A half-day request must have the same start and end date.")


def assert_no_overlap(db: Session, employee_id: int, start_date: date, end_date: date, exclude_request_id: int | None = None) -> None:
    """LMS-037: refuse overlap with the employee's own request in
    Pending/Approved/Cancellation Requested."""
    existing = leave_request_dao.find_overlapping_for_employee(db, employee_id, start_date, end_date, exclude_request_id)
    if existing is not None:
        raise AppError(
            "OVERLAP",
            f"This overlaps an existing request (#{existing.request_id}, {existing.start_date} to {existing.end_date}).",
        )


def medical_certificate_threshold(db: Session, leave_type, deducted_days: float) -> int | None:
    """The day threshold when this request needs a medical certificate, else None: sick leave of
    MORE than `sick_leave.medical_cert_threshold_days` (3) working days. 1-3 days need no proof."""
    if not leave_type or not leave_type.is_sick_leave:
        return None
    threshold = config_service.get(db, "sick_leave.medical_cert_threshold_days")
    return threshold if float(deducted_days) > threshold else None


def assert_medical_attachment(db: Session, leave_type, deducted_days: float, request_id: int | None) -> None:
    """Sick leave longer than the configured threshold needs a medical file.
    A fresh submission has no request row to attach to yet, so it is refused
    and the client must go through draft -> upload -> submit-draft."""
    threshold = medical_certificate_threshold(db, leave_type, deducted_days)
    if threshold is None:
        return
    if request_id is not None and leave_request_attachment_dao.list_for_request(db, request_id):
        return
    raise AppError(
        "MEDICAL_CERT_REQUIRED",
        f"Sick leave longer than {threshold} day(s) needs a medical certificate attached before it can be submitted.",
    )


def assert_within_backdating_window(db: Session, start_date: date, leave_year) -> None:
    """BR-27/BR-28: backdating window capped at the leave-year start; a closed
    year is never touched."""
    if leave_year.is_closed:
        raise AppError("CLOSED_YEAR", "This leave year is closed and can no longer be modified.")
    window_days = config_service.get(db, "backdating.window_days")
    earliest = max(date.today() - timedelta(days=window_days), leave_year.start_date)
    if start_date < earliest:
        raise AppError("BACKDATING_WINDOW_EXCEEDED", f"The earliest backdated start date allowed is {earliest.isoformat()}.")
