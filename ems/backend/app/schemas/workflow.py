"""Inbox, delegation, finance and notification view models."""
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.claim import ClaimSummary
from app.schemas.common import ORM, Money, UserBrief


class InboxItem(BaseModel):
    step_id: int
    level: str
    claim_id: int
    claim_no: str | None
    claim_type: str
    title: str
    employee: UserBrief
    line_id: int | None
    category_name: str | None
    expense_date: date | None
    merchant: str | None
    amount: Money | None
    flags: list[str]
    self_approved: bool
    on_behalf_of: str | None
    next_step: str  # where it goes after this approval
    prev_approval: str | None = None  # "Maya Iyer, 2026-10-04" for Level 2 items
    prev_approved_at: datetime | None = None
    line_count: int = 1
    waiting_since: datetime


class ApproveIn(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0)
    comment: str | None = None


class BulkIn(BaseModel):
    step_ids: list[int]


class BulkReturnIn(BaseModel):
    claim_ids: list[int]
    reason: str


class DelegationIn(BaseModel):
    delegate_id: int
    start_date: date
    end_date: date
    reason: str = ""


class DelegationOut(ORM):
    id: int
    delegator: UserBrief
    delegate: UserBrief
    start_date: date
    end_date: date
    reason: str
    cancelled_at: datetime | None
    is_active_now: bool = False


class BatchPreviewOut(BaseModel):
    month: str
    claims: list[ClaimSummary]
    claim_count: int
    total_amount: Money
    recoveries: list[ClaimSummary]
    recovery_total: Money


class BatchIn(BaseModel):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    expected_count: int


class BatchOut(ORM):
    id: int
    month: str
    created_at: datetime
    claim_count: int
    total_amount: Money
    recovery_total: Money


class PaymentQueueOut(BaseModel):
    ready: list[ClaimSummary]
    sent: list[ClaimSummary]
    failed: list[ClaimSummary]


class AdvanceRow(BaseModel):
    claim: ClaimSummary
    due_date: date | None
    overdue: bool


class NotificationOut(ORM):
    id: int
    message: str
    link: str
    is_read: bool
    created_at: datetime
