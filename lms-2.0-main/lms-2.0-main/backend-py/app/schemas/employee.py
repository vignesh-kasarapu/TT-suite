from datetime import date
from pathlib import PurePath

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.base import CamelOut
from app.schemas.leave_request import LeaveRequestWithTypeOut, LeaveYearOut
from app.schemas.leave_type import LeaveTypeOut, _blank_to_none


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    employee_id: int
    full_name: str
    work_email: str
    employee_code: str
    designation: str | None
    department_id: int | None
    grade_id: int | None
    management_level_id: int | None
    region_id: int | None
    reporting_manager_id: int | None
    gender: str | None
    marital_status: str | None
    status: str
    phone: str | None
    personal_email: str | None
    date_of_birth: date | None
    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    has_avatar: bool = False
    # The edit screen decides whether to offer a management level from these. It used to
    # read a nested `Roles` array that this schema never produced, so the field was
    # unreachable no matter what roles someone held.
    roles: list[str] = []
    # Changes every time a new picture is stored, so the client can bust the browser cache
    # on an avatar URL that is otherwise identical before and after an upload. Derived from
    # the stored filename's timestamp — the path itself is never exposed.
    avatar_version: str | None = None

    @classmethod
    def from_model(cls, employee) -> "EmployeeOut":
        data = cls.model_validate(employee).model_dump()
        data["has_avatar"] = bool(employee.avatar_path)
        data["avatar_version"] = PurePath(employee.avatar_path).stem.rsplit("-", 1)[-1] if employee.avatar_path else None
        data["roles"] = sorted({grant.role.role_code for grant in getattr(employee, "role_grants", []) if grant.role})
        return cls(**data)


class UpdateEmployeeDetailsIn(BaseModel):
    """HR edits LMS data only. The name, the work email (the sign-in identity) and the
    employee code belong to the suite person and are managed by the global admin in the
    portal, so sending them is a 422 rather than a silent no-op."""

    model_config = ConfigDict(extra="forbid")

    designation: str | None = None
    management_level_id: int | None = None
    gender: str | None = None
    marital_status: str | None = None
    region_id: int | None = None
    grade_id: int | None = None
    department_name: str | None = None
    # The selectable leave types that apply to this person; the rest are hidden from them.
    applicable_leave_type_ids: list[int] | None = None

    # An empty <select> sends "" — that means "none", and the service stores it as NULL.
    _blank_ids = field_validator("management_level_id", "region_id", "grade_id", mode="before")(_blank_to_none)


class UpdateOwnProfileIn(BaseModel):
    phone: str | None = None
    personal_email: str | None = None
    date_of_birth: date | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    gender: str | None = None
    marital_status: str | None = None

    _blank_date = field_validator("date_of_birth", mode="before")(_blank_to_none)


class UpdateManagerIn(BaseModel):
    manager_id: int


class DashboardBalanceCardOut(CamelOut):
    """Node's getDashboard hand-builds this — camelCase wrapper keys around a
    nested, still-snake_case LeaveType model dump. See app/schemas/base.py."""

    leave_type: LeaveTypeOut
    ledger_balance: float
    committed_to_open_requests: float
    effective_balance: float


class TeamMemberBalanceOut(CamelOut):
    """Node's getTeamBalances hand-builds this too, but with `leaveType` as
    just the type_name STRING — a genuinely different shape from the
    dashboard's nested model, not a copy/paste of the same schema."""

    leave_type: str
    ledger_balance: float
    committed_to_open_requests: float
    effective_balance: float


class TeamBalanceRowOut(CamelOut):
    employee: EmployeeOut
    balances: list[TeamMemberBalanceOut]

    @classmethod
    def from_row(cls, row: dict) -> "TeamBalanceRowOut":
        return cls(employee=EmployeeOut.from_model(row["employee"]), balances=[TeamMemberBalanceOut(**b) for b in row["balances"]])


class CalendarPersonOut(BaseModel):
    employee_id: int
    employee_code: str
    full_name: str | None
    designation: str | None


class CalendarLeaveTypeOut(BaseModel):
    leave_type_id: int
    type_code: str
    type_name: str


class PeerCalendarEntryOut(BaseModel):
    """BR-41/NFR-14: a peer sees name, dates and status — never the leave type,
    the deducted days or the reason. That is why those live on the Team subclass
    rather than here."""

    request_id: int
    employee_id: int
    employee_name: str | None
    employee: CalendarPersonOut | None = None
    start_date: date
    end_date: date
    state: str


class TeamCalendarEntryOut(PeerCalendarEntryOut):
    leave_type_id: int
    leave_type_name: str | None
    # Node eager-loaded the leave type; the day inspector reads the nested object.
    LeaveType: CalendarLeaveTypeOut | None = None
    deducted_days: float | None = None
    is_half_day: bool = False
    half_day_portion: str | None = None
    reason: str | None = None


class RoleChangeRequestIn(BaseModel):
    """`role` is the suite role (employee | manager | admin) or null for "no access"."""

    role: str | None = None
    note: str = ""


class ReassignManagerIn(BaseModel):
    new_manager_id: int
    transfer_pending_requests: bool = False


class DashboardOut(CamelOut):
    """Node's getDashboard hand-builds { balances, pending, upcoming,
    withdrawalWindow, leaveYear } — different key names from what the
    service/DAO layer calls these internally, not just different casing."""

    balances: list[DashboardBalanceCardOut]
    # Enriched rows (leave type + current approver), same shape My Requests serves — the
    # dashboard lists are unreadable when every row names only a leave_type_id.
    pending: list[LeaveRequestWithTypeOut]
    upcoming: list[LeaveRequestWithTypeOut]
    withdrawal_window: list[LeaveRequestWithTypeOut]
    loss_of_pay: list[LeaveRequestWithTypeOut] = []
    leave_year: LeaveYearOut
