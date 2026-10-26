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


class EncashmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    encashment_id: int
    employee_id: int
    leave_type_id: int
    leave_year_id: int
    days_encashed: float
    status: str
    requested_at: datetime
    notes: str | None


class CompOffCreateIn(BaseModel):
    employee_id: int
    work_date: date
    hours_or_days: float
    notes: str | None = None


class CompOffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    comp_off_id: int
    employee_id: int
    work_date: date
    hours_or_days: float
    approved_by: int
    notes: str | None


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
