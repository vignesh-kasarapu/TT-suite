from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class LeaveTakenRowOut(BaseModel):
    request_id: int
    employee_id: int
    employee_name: str
    employee_code: str
    department_id: int | None
    grade_id: int | None
    leave_type_id: int
    leave_type_name: str
    start_date: date
    end_date: date
    state: str
    deducted_days: float | None


class LopReportRowOut(BaseModel):
    # CONVERTED: the automatic conversion (a lop_records row). APPLIED: leave requested as LOP,
    # with its state (APPROVED counts as unpaid; PENDING_* is still waiting for a decision).
    source: str = "CONVERTED"
    state: str | None = None
    lop_record_id: int | None = None
    request_id: int
    employee_id: int
    employee_name: str
    employee_code: str
    # What the leave was before the conversion. Payroll needs to know a day became unpaid;
    # HR needs to know which entitlement it came out of, and the row carried neither.
    prior_leave_type_name: str | None = None
    start_date: date
    end_date: date
    deducted_days: float
    converted_at: datetime | None = None
    applied_at: datetime | None = None
    # ADVANCE rows (approved leave beyond the balance): the whole leave, what the balance covered,
    # the LOP days (= deducted_days), and the employee's decision (PENDING until the deadline).
    leave_type_name: str | None = None
    total_days: float | None = None
    balance_days: float | None = None
    lop_status: str | None = None
    lop_decision_deadline: datetime | None = None


class LopPendingRowOut(BaseModel):
    """Rejected advance leave still inside its withdrawal window — not loss of pay yet."""

    request_id: int
    employee_id: int
    employee_name: str
    employee_code: str
    leave_type_name: str | None = None
    start_date: date
    end_date: date
    deducted_days: float | None
    withdrawal_window_end: datetime | None
    days_left_to_withdraw: int | None


class BalanceReportRowOut(BaseModel):
    entry_id: int
    employee_id: int
    employee_name: str
    employee_code: str
    leave_type_id: int
    leave_type_name: str
    entry_type: str
    quantity: float
    created_at: datetime


class AuditLogRowOut(BaseModel):
    audit_id: int
    actor_id: int | None
    actor_name: str | None
    is_system_actor: bool
    action: str
    entity_type: str
    entity_id: str
    prior_value: Any
    new_value: Any
    timestamp: datetime


class EncashmentReportRowOut(BaseModel):
    """One encashment request, with everything a reviewer or payroll needs: days, who asked,
    who decided and when. No amount — LMS records days, never money."""
    encashment_id: int
    employee_id: int
    employee_name: str
    employee_code: str
    leave_type_name: str | None = None
    leave_year_code: str | None = None
    days_requested: float
    days_encashed: float | None = None
    status: str
    requested_by_name: str | None = None
    requested_at: datetime
    decided_by_name: str | None = None
    decided_at: datetime | None = None
    notes: str | None = None
    decision_notes: str | None = None


class CompOffReportRowOut(BaseModel):
    """One compensatory-off claim through its two approval stages."""
    comp_off_id: int
    employee_id: int
    employee_name: str
    employee_code: str
    work_date: date
    hours_worked: float | None = None
    days: float
    status: str
    leave_year_code: str | None = None
    manager_name: str | None = None
    manager_decided_at: datetime | None = None
    hr_name: str | None = None
    hr_decided_at: datetime | None = None
    notes: str | None = None
