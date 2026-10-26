"""Mirrors leaveRequest.service.js's previewApplication. LMS-033 to LMS-040:
builds the live "cost" preview shown on the Apply screen (LMS-036), without
creating a request. Never a bare number. No DB writes."""
from datetime import date

from sqlalchemy.orm import Session

from app.dao import leave_year_dao
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
    projected_balance = balance["effective_balance"] - breakdown["deducted_working_days"]
    shortfall = abs(projected_balance) if projected_balance < 0 else 0

    return {
        **breakdown, **balance, "projected_balance": projected_balance,
        "is_advance_leave": shortfall > 0, "shortfall": shortfall, "leave_year": leave_year,
    }
