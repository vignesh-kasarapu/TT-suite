from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.common import ORM, Money


class CategoryIn(BaseModel):
    name: str = Field(min_length=2)
    kind: Literal["EXPENSE", "ADVANCE"] = "EXPENSE"
    group_name: str = ""
    description: str | None = None
    gl_code: str = ""
    gst_credit_eligible: bool = False
    taxable: bool = False
    receipt_required: bool = True
    receipt_threshold: Money | None = None
    extra_field_label: str | None = None
    is_active: bool = True


class CategoryOut(ORM):
    id: int
    name: str
    kind: str
    group_name: str
    description: str | None
    gl_code: str
    gst_credit_eligible: bool
    taxable: bool
    receipt_required: bool
    receipt_threshold: Money | None
    extra_field_label: str | None
    is_active: bool


class LimitIn(BaseModel):
    category_id: int
    scope: Literal["EMPLOYEE", "DEPARTMENT", "COMPANY"]
    scope_value: str | None = None
    period: Literal["LINE", "DAY", "MONTH", "YEAR"]
    amount: Decimal = Field(gt=0)
    action: Literal["BLOCK", "FLAG", "WARN"]
    effective_from: date
    effective_to: date | None = None
    is_active: bool = True


class LimitOut(ORM):
    id: int
    category_id: int
    scope: str
    scope_value: str | None
    period: str
    amount: Money
    action: str
    effective_from: date
    effective_to: date | None
    is_active: bool


class ReassignIn(BaseModel):
    step_id: int
    approver_id: int


class AuditOut(ORM):
    id: int
    at: datetime
    actor_name: str | None
    on_behalf_of_name: str | None
    action: str
    entity: str
    entity_id: str
    claim_id: int | None
    claim_no: str | None
    level: str | None
    amount: Money | None
    self_approved: bool
    details: dict
