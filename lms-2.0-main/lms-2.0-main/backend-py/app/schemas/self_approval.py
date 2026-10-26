from datetime import date

from pydantic import BaseModel, ConfigDict


class SelfApprovalGrantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    self_approval_permission_id: int
    employee_id: int
    granted_by: int
    effective_from: date
    effective_to: date | None
    is_active: bool
    notes: str | None


class SelfApprovalGrantIn(BaseModel):
    employee_id: int
    effective_from: date
    effective_to: date | None = None
    notes: str | None = None
