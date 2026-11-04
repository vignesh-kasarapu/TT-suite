from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict


class SelfApprovalGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    #: How long it runs, read back from the dates: "leave_year", "until_deactivated" or
    #: "dates". Nothing is stored for it — the dates are the grant.
    duration: str | None = None
    self_approval_permission_id: int
    employee_id: int
    granted_by: int
    effective_from: date
    effective_to: date | None
    is_active: bool
    notes: str | None


class SelfApprovalGrantIn(BaseModel):
    """How long the grant runs:

    * `dates` — exactly the dates given (what this has always done);
    * `leave_year` — from today (or the date given) to the end of the current leave year;
    * `until_deactivated` — open-ended: it lasts until the employee is deactivated, or until
      HR revokes it.
    """

    employee_id: int
    duration: Literal["dates", "leave_year", "until_deactivated"] = "dates"
    #: Optional for the two presets: they start today unless a later start is given.
    effective_from: date | None = None
    effective_to: date | None = None
    notes: str | None = None
