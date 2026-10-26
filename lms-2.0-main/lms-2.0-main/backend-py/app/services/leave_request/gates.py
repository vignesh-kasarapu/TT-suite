"""Shared gate sequence for submit_request and submit_draft — kept in one
place so a submitted draft can never silently skip a gate a fresh submission
runs."""
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.services import approval_routing_service, balance_service, config_service, blackout_period_service, business_day_service, team_capacity_service
from app.services.leave_request import validation


def run_submission_gates(
    db: Session, employee, leave_type, start_date: date, end_date: date, is_half_day: bool, leave_year, exclude_request_id: int | None = None
) -> dict:
    validation.assert_gender_eligible(leave_type, employee)
    validation.assert_valid_date_span(start_date, end_date)
    validation.assert_valid_half_day(start_date, end_date, is_half_day)
    validation.assert_within_backdating_window(db, start_date, leave_year)
    validation.assert_no_overlap(db, employee.employee_id, start_date, end_date, exclude_request_id)
    blackout_period_service.assert_no_blackout_conflict(db, leave_type.leave_type_id, start_date, end_date)
    team_capacity_service.assert_within_capacity(db, employee.employee_id, start_date, end_date)

    breakdown = business_day_service.compute_deduction_breakdown(
        db, start_date, end_date, is_half_day, leave_year.leave_year_id, employee.employee_id
    )
    if breakdown["deducted_working_days"] <= 0:
        raise AppError("ZERO_DEDUCTION", "This span deducts zero working days — nothing to submit.")

    max_days = config_service.get(db, "leave.max_days_per_request")
    if max_days > 0 and breakdown["deducted_working_days"] > max_days:
        raise AppError(
            "MAX_DAYS_EXCEEDED",
            f"A single request cannot exceed {max_days} working days (this one is {breakdown['deducted_working_days']:g}). Split it into separate requests.",
        )

    balance = balance_service.get_effective_balance(db, employee.employee_id, leave_type.leave_type_id, leave_year.leave_year_id)
    # BR-11: warn, never block.
    is_advance_leave = breakdown["deducted_working_days"] > balance["effective_balance"]

    aggregate_days = approval_routing_service.get_contiguous_aggregate_days(
        db, employee.employee_id, leave_type.leave_type_id, start_date, end_date, leave_year_id=leave_year.leave_year_id
    )
    is_long_leave = approval_routing_service.requires_long_leave_second_stage(
        db, breakdown["deducted_working_days"], aggregate_days
    )

    return {
        "breakdown": breakdown, "balance": balance, "is_advance_leave": is_advance_leave,
        "aggregate_days": aggregate_days, "is_long_leave": is_long_leave,
    }
