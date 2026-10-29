"""Mirrors leaveRequest.service.js's previewApplication. LMS-033 to LMS-040:
builds the live "cost" preview shown on the Apply screen (LMS-036), without
creating a request. Never a bare number. No DB writes."""
from datetime import date

from sqlalchemy.orm import Session

from app.dao import leave_type_dao, leave_year_dao
from app.services import balance_service, business_day_service
from app.services.leave_request import validation


def preview_application(db: Session, employee_id: int, leave_type_id: int, start_date: date, end_date: date, is_half_day: bool) -> dict:
    validation.assert_valid_date_span(start_date, end_date)
    validation.assert_valid_half_day(start_date, end_date, is_half_day)

    leave_year = leave_year_dao.find_current(db)
    breakdown = business_day_service.compute_deduction_breakdown(
        db, start_date, end_date, is_half_day, leave_year.leave_year_id, employee_id
    )
    balance = balance_service.get_effective_balance(db, employee_id, leave_type_id, leave_year.leave_year_id)
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    projected_balance = balance["effective_balance"] - breakdown["deducted_working_days"]
    # A type with no balance (LOP, unpaid by definition) never runs short.
    shortfall = abs(projected_balance) if projected_balance < 0 and (leave_type is None or leave_type.is_balance_affecting) else 0

    # Sick leave over the threshold: the Apply screen warns before submit (submission refuses it
    # without a certificate, see validation.assert_medical_attachment).
    threshold = validation.medical_certificate_threshold(db, leave_type, breakdown["deducted_working_days"])
    return {
        **breakdown, **balance, "projected_balance": projected_balance,
        "is_advance_leave": shortfall > 0, "shortfall": shortfall, "leave_year": leave_year,
        "medical_certificate_required": threshold is not None,
        "medical_certificate_after_days": threshold,
    }
