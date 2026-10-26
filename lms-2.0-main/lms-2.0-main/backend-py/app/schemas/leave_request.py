from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.schemas.base import CamelOut


class LeaveYearOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    leave_year_id: int
    year_code: str
    start_date: date
    end_date: date
    is_current: bool
    is_closed: bool


class DayBreakdownOut(CamelOut):
    """Entirely hand-built in Node's computeDeductionBreakdown — camelCase.
    See app/schemas/base.py."""

    date: date
    weekday_code: str
    is_weekend: bool
    is_holiday: bool
    deducted: bool
    excluded_reason: str | None


class PreviewOut(CamelOut):
    """Node's previewApplication flattens two already-hand-built camelCase
    sub-objects (the deduction breakdown + the balance) plus 3 more camelCase
    keys of its own — the single most heavily camelCase response in the app.
    leave_year is the one real nested model, so it stays snake_case inside."""

    calendar_days_selected: int
    deducted_working_days: float
    days: list[DayBreakdownOut]
    weekend_counted: bool
    holidays_counted: bool
    ledger_balance: float
    committed_to_open_requests: float
    effective_balance: float
    projected_balance: float
    is_advance_leave: bool
    shortfall: float
    leave_year: LeaveYearOut


class LeaveRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    request_id: int
    employee_id: int
    leave_type_id: int
    leave_year_id: int
    start_date: date
    end_date: date
    is_half_day: bool
    half_day_portion: str | None
    reason: str
    state: str
    deducted_days: float | None
    is_advance_leave: bool
    is_long_leave: bool
    current_approver_id: int | None


class RequestLeaveTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    leave_type_id: int
    type_code: str
    type_name: str


class RequestApproverOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    employee_id: int
    employee_code: str
    full_name: str | None
    designation: str | None


class LeaveRequestWithTypeOut(LeaveRequestOut):
    """Any list a requester reads — My Requests, and the dashboard's pending/upcoming —
    needs the leave type's name, which the bare row only carries as an id. Node's
    equivalents eager-loaded it, hence the `LeaveType` key rather than a snake_case one."""

    LeaveType: RequestLeaveTypeOut | None = None
    currentApprover: RequestApproverOut | None = None
    # A request approved with no manager in the chain went through the self-approval
    # addendum; without this the row looks like it was never reviewed at all.
    is_self_approved: bool = False


class SubmitRequestIn(BaseModel):
    leave_type_id: int
    start_date: date
    end_date: date
    is_half_day: bool = False
    half_day_portion: str | None = None
    reason: str
    attachment_refs: list[str] = []


class DraftIn(BaseModel):
    leave_type_id: int
    start_date: date
    end_date: date
    is_half_day: bool = False
    half_day_portion: str | None = None
    reason: str


class DraftUpdateIn(BaseModel):
    leave_type_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    is_half_day: bool | None = None
    half_day_portion: str | None = None
    reason: str | None = None


class DecisionIn(BaseModel):
    decision: str  # APPROVE|REJECT
    reason: str | None = None


class CancellationDecisionIn(BaseModel):
    decision: str  # APPROVE|REJECT
    unelapsed_days: float | None = None


class AddWatcherIn(BaseModel):
    watcher_employee_id: int


class LeaveRequestDetailOut(BaseModel):
    scope: str  # FULL|WATCHER_MASKED|DENIED
    request: dict[str, Any] | None
