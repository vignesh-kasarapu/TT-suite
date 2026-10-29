from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.common import ORM, Money, UserBrief


class LineIn(BaseModel):
    id: int | None = None
    category_id: int
    expense_date: date
    merchant: str = ""
    description: str = ""
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    cost_centre: str = ""
    state: str = ""
    invoice_no: str = ""
    supplier_gstin: str = ""
    buyer_gstin: str = ""
    cgst: Decimal = Field(default=Decimal(0), ge=0)
    sgst: Decimal = Field(default=Decimal(0), ge=0)
    igst: Decimal = Field(default=Decimal(0), ge=0)
    extra_field_value: str = ""
    justification: str = ""
    receipt_path: str | None = None
    receipt_name: str | None = None


class ClaimIn(BaseModel):
    title: str = ""
    project: str = ""
    purpose: str = ""
    lines: list[LineIn] = []


class PolicyCheckIn(BaseModel):
    claim_id: int | None = None
    lines: list[LineIn]


class AdvanceIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    purpose: str = Field(min_length=3)
    expected_settlement_date: date


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class CommentOut(BaseModel):
    id: int
    author_id: int
    author_name: str
    body: str
    created_at: datetime


class LineOut(ORM):
    id: int
    category_id: int
    category_name: str
    expense_date: date
    merchant: str
    description: str
    amount: Money
    approved_amount: Money | None
    status: str
    reject_reason: str | None
    cost_centre: str
    state: str
    invoice_no: str
    supplier_gstin: str
    buyer_gstin: str
    cgst: Money
    sgst: Money
    igst: Money
    gst_credit_eligible: bool | None
    extra_field_value: str
    justification: str
    receipt_path: str | None
    receipt_name: str | None
    policy_flags: list[dict]
    duplicate_flags: list[dict]
    duplicate_cleared_reason: str | None


class StepOut(BaseModel):
    id: int
    line_id: int | None
    round: int
    level: str
    status: str
    approver_name: str | None
    current_approver_name: str | None  # after delegation; "Any Finance Reviewer" for the pool
    amount: Money | None
    approved_amount: Money | None
    acted_by_name: str | None
    on_behalf_of_name: str | None
    acted_at: datetime | None
    comment: str | None
    self_approved: bool
    escalated: bool
    activated_at: datetime


class ClaimSummary(ORM):
    id: int
    claim_no: str | None
    type: str
    title: str
    project: str
    purpose: str
    status: str
    employee: UserBrief
    line_count: int
    receipt_line_ids: list[int] = []
    stage: str
    waiting_on: str
    stage_since: datetime
    submitted_at: datetime | None
    self_approved: bool
    total_claimed: Money
    total_approved: Money | None
    payout_amount: Money | None
    payment_month: str | None
    advance_balance: Money | None
    advance_status: str | None
    updated_at: datetime


class ClaimDetail(ClaimSummary):
    round: int
    return_reason: str | None
    finance_approved_at: datetime | None
    advance_deducted: Money
    paid_at: datetime | None
    failure_reason: str | None
    expected_settlement_date: date | None
    lines: list[LineOut]
    steps: list[StepOut]
    waiting_on_steps: list[str]  # FR-6.6: "Level 1 - Priya (for Ravi)"
    comments: list[CommentOut]
    can_withdraw: bool
    my_step_ids: list[int]  # pending steps the viewer can act on
    can_edit: bool
    can_finance_act: bool
    can_reassign: bool
