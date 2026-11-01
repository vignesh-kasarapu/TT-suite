from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class BlackoutPeriodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    blackout_id: int
    name: str
    start_date: date
    end_date: date
    leave_type_id: int | None
    is_active: bool


class BlackoutPeriodCreateIn(BaseModel):
    name: str
    start_date: date
    end_date: date
    leave_type_id: int | None = None


class BlackoutPeriodUpdateIn(BaseModel):
    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    leave_type_id: int | None = None


class ActiveIn(BaseModel):
    is_active: bool


class TeamCapacityLimitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    capacity_limit_id: int
    manager_employee_id: int
    max_concurrent_on_leave: int
    effective_from: date
    effective_to: date | None


class TeamCapacityLimitWithManagerOut(TeamCapacityLimitOut):
    manager_name: str | None


class TeamCapacityLimitCreateIn(BaseModel):
    manager_employee_id: int
    max_concurrent_on_leave: int
    effective_from: date
    effective_to: date | None = None


class TeamCapacityLimitUpdateIn(BaseModel):
    max_concurrent_on_leave: int | None = None
    effective_from: date | None = None
    effective_to: date | None = None


class EncashmentCreateIn(BaseModel):
    employee_id: int
    leave_type_id: int
    leave_year_id: int
    days_encashed: float
    notes: str | None = None


class DecisionIn(BaseModel):
    """One shape for both approval decisions — encashment and compensatory off."""
    approve: bool
    comments: str | None = None


class EncashmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    encashment_id: int
    employee_id: int
    leave_type_id: int
    leave_year_id: int
    days_encashed: float
    status: str
    requested_by: int
    requested_at: datetime
    notes: str | None
    decided_by: int | None = None
    decided_at: datetime | None = None
    decision_notes: str | None = None
    ledger_entry_id: int | None = None


class EncashmentRowOut(EncashmentOut):
    """A request with the names the review screens show beside it."""
    employee_name: str
    employee_code: str
    leave_type_name: str | None = None
    decided_by_name: str | None = None


class EncashableBalanceOut(BaseModel):
    employee_id: int
    leave_type_id: int
    leave_year_id: int
    ledger_balance: float
    effective_balance: float
    reserved_by_pending_encashments: float
    encashable_balance: float
    max_days_per_request: int


class CompOffCreateIn(BaseModel):
    """`hours_worked` is the claim; the day figure is derived from it (8 hours = 1 day).
    `hours_or_days` is still accepted so existing callers (the mobile app) keep working —
    it is read as hours when `hours_worked` is absent."""
    employee_id: int
    work_date: date
    hours_worked: float | None = None
    hours_or_days: float | None = None
    notes: str | None = None


class CompOffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    comp_off_id: int
    employee_id: int
    work_date: date
    hours_worked: float | None = None
    hours_or_days: float
    leave_year_id: int | None = None
    status: str
    requested_by: int | None = None
    manager_id: int | None = None
    manager_decided_at: datetime | None = None
    manager_comments: str | None = None
    hr_id: int | None = None
    hr_decided_at: datetime | None = None
    hr_comments: str | None = None
    approved_by: int | None = None
    ledger_entry_id: int | None = None
    notes: str | None


class CompOffRowOut(CompOffOut):
    """A request with the employee's name, for the manager and HR queues."""
    employee_name: str
    employee_code: str


class StandingWatcherOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    standing_watcher_id: int
    watched_employee_id: int
    watcher_employee_id: int
    from_date: date
    to_date: date
    added_by_id: int


class StandingWatcherCreateIn(BaseModel):
    watcher_employee_id: int
    from_date: date
    to_date: date


class CalendarFeedSubscribeIn(BaseModel):
    scope: str = "OWN"  # OWN|TEAM


class CalendarFeedSubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    subscription_id: int
    employee_id: int
    scope: str
    is_active: bool
    revoked_at: datetime | None
