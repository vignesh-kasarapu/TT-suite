"""Mirrors employee.service.js's getDashboard (LMS-036/dashboard)."""
from datetime import date

from sqlalchemy.orm import Session

from app.dao import employee_dao, leave_request_query_dao, leave_type_dao, leave_year_dao
from app.schemas.leave_type import LeaveTypeOut
from app.services import balance_service
from app.services.leave_request import validation


def get_dashboard(db: Session, employee_id: int) -> dict:
    """Shape matches Node's getDashboard exactly (see app/schemas/employee.py's
    DashboardOut/DashboardBalanceCardOut docstrings) — each balance entry
    nests the full LeaveType model under "leave_type", not a flattened id/
    name/code trio."""
    leave_year = leave_year_dao.find_current(db)

    employee = employee_dao.find_by_id(db, employee_id)
    balances = [
        {
            # `is_eligible` lets the Apply picker disable a restricted type up front rather
            # than failing the submission; the balance itself is still shown.
            "leave_type": {
                **LeaveTypeOut.model_validate(leave_type).model_dump(),
                "is_eligible": validation.is_gender_eligible(leave_type, employee),
            },
            **balance_service.get_effective_balance(db, employee_id, leave_type.leave_type_id, leave_year.leave_year_id),
        }
        for leave_type in leave_type_dao.list_selectable(db)
    ]

    return {
        "balances": balances,
        "pending": leave_request_query_dao.list_pending_for_employee(db, employee_id),
        "upcoming": leave_request_query_dao.list_upcoming_approved(db, employee_id, date.today(), 5),
        "withdrawal_window": leave_request_query_dao.list_withdrawal_window(db, employee_id),
        "leave_year": leave_year,
    }
