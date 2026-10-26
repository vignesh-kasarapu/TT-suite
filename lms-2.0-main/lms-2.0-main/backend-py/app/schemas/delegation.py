from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.base import CamelOut


class DelegateCandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    employee_id: int
    full_name: str
    employee_code: str


class EligibleDelegatesOut(CamelOut):
    """Node hand-builds { candidates, fallbackUsed } — candidates is an array
    of real Employee models (snake_case inside, untouched); fallbackUsed is
    the one genuinely camelCase wrapper key. See app/schemas/base.py."""

    candidates: list[DelegateCandidateOut]
    fallback_used: bool


class NominateIn(BaseModel):
    delegate_id: int
    from_date: date
    to_date: date


class NominateOnBehalfIn(BaseModel):
    nominator_id: int
    delegate_id: int
    from_date: date
    to_date: date


class DelegationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    delegation_id: int
    nominator_id: int
    delegate_id: int
    set_by_id: int
    from_date: date
    to_date: date
    revoked_at: datetime | None


class DelegationWithNamesOut(DelegationOut):
    nominator_name: str | None
    delegate_name: str | None
