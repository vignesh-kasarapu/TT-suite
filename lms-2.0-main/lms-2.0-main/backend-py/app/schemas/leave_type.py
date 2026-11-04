from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


def _blank_to_none(value):
    """The admin form sends "" for an empty optional number — that means "no value", not a type error."""
    return None if isinstance(value, str) and not value.strip() else value


class LeaveTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    leave_type_id: int
    type_code: str
    type_name: str
    is_sick_leave: bool
    is_balance_affecting: bool
    is_system: bool
    is_selectable_by_employee: bool
    permits_half_day: bool
    permits_attachments: bool
    gender_eligibility: str = "ALL"
    marital_eligibility: str = "ANY"
    # Resolved against the signed-in employee where the caller knows who that is, so the
    # Apply screen can grey a type out instead of letting them fill in a form that will be
    # refused on submit. None means "not evaluated for anyone in particular".
    is_eligible: bool | None = None
    #: Why not, in words the Apply screen shows under a greyed-out type.
    ineligibility_reason: str | None = None
    #: Set when the type has been archived (soft delete): it keeps all its history but
    #: nobody can apply for it and it is off every dashboard.
    archived_at: datetime | None = None


class LeavePolicyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    policy_id: int
    leave_type_id: int
    annual_entitlement: float
    carries_forward: bool
    carry_forward_cap: float | None


class LeaveAccrualConfigOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    accrual_config_id: int
    leave_type_id: int
    accrual_method: str
    posting_day: int | None


class EntitlementPoolOut(BaseModel):
    """The shared entitlement a leave type draws on, when it has one."""

    model_config = ConfigDict(from_attributes=True)
    pool_id: int
    pool_code: str
    pool_name: str
    annual_entitlement: float
    carries_forward: bool
    carry_forward_cap: float | None = None


class LeaveTypeWithPolicyOut(BaseModel):
    leave_type: LeaveTypeOut
    policy: LeavePolicyOut | None
    accrual_config: LeaveAccrualConfigOut | None
    pool: EntitlementPoolOut | None = None


# LMS-025 is enforced structurally: is_system/is_selectable_by_employee are never
# settable through this create path, so a caller can never mint a second LOP.
class LeaveTypeCreateIn(BaseModel):
    type_code: str
    type_name: str
    is_sick_leave: bool = False
    is_balance_affecting: bool = True
    permits_half_day: bool = False
    permits_attachments: bool = False
    annual_entitlement: float
    carries_forward: bool = False
    carry_forward_cap: float | None = None
    #: Join an existing shared entitlement pool instead of holding days of this type's own.
    pool_id: int | None = None

    _blank_cap = field_validator("carry_forward_cap", "pool_id", mode="before")(_blank_to_none)


class LeaveTypePolicyUpdateIn(BaseModel):
    annual_entitlement: float | None = None
    gender_eligibility: str | None = None
    marital_eligibility: str | None = None
    carries_forward: bool | None = None
    carry_forward_cap: float | None = None
    is_selectable_by_employee: bool | None = None
    pool_id: int | None = None

    _blank_cap = field_validator("annual_entitlement", "carry_forward_cap", "pool_id", mode="before")(_blank_to_none)


class EntitlementPoolIn(BaseModel):
    pool_code: str
    pool_name: str
    annual_entitlement: float
    carries_forward: bool = False
    carry_forward_cap: float | None = None
    leave_type_ids: list[int] = []

    _blank_cap = field_validator("carry_forward_cap", mode="before")(_blank_to_none)


class EntitlementPoolUpdateIn(BaseModel):
    pool_name: str | None = None
    annual_entitlement: float | None = None
    carries_forward: bool | None = None
    carry_forward_cap: float | None = None
    leave_type_ids: list[int] | None = None

    _blank_cap = field_validator("annual_entitlement", "carry_forward_cap", mode="before")(_blank_to_none)
