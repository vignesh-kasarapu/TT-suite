from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.config import Category
from app.models.user import User


class Claim(Base):
    """An expense claim, or a cash advance (type ADVANCE, one line in the ADVANCE category)."""

    __tablename__ = "claims"

    id: Mapped[int] = mapped_column(primary_key=True)
    claim_no: Mapped[str | None] = mapped_column(String(20), unique=True)
    type: Mapped[str] = mapped_column(String(20), default="EXPENSE")
    employee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    project: Mapped[str] = mapped_column(String(100), default="")
    purpose: Mapped[str] = mapped_column(Text, default="")  # business purpose
    status: Mapped[str] = mapped_column(String(30), default="DRAFT", index=True)
    round: Mapped[int] = mapped_column(Integer, default=0)  # +1 on every submit; steps carry the round
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    self_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    total_claimed: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    total_approved: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    return_reason: Mapped[str | None] = mapped_column(Text)  # send back / reject reason
    finance_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_month: Mapped[str | None] = mapped_column(String(7))  # YYYY-MM
    advance_deducted: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    payout_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    payroll_batch_id: Mapped[int | None] = mapped_column(ForeignKey("payroll_batches.id"))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    # Cash advance only
    expected_settlement_date: Mapped[date | None] = mapped_column(Date)
    advance_balance: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    advance_status: Mapped[str | None] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    employee: Mapped[User] = relationship()
    lines: Mapped[list["ClaimLine"]] = relationship(
        back_populates="claim", cascade="all, delete-orphan", order_by="ClaimLine.id"
    )
    steps: Mapped[list["ApprovalStep"]] = relationship(
        back_populates="claim", cascade="all, delete-orphan", order_by="ApprovalStep.id"
    )
    comments: Mapped[list["ClaimComment"]] = relationship(
        back_populates="claim", cascade="all, delete-orphan", order_by="ClaimComment.id"
    )

    @property
    def line_count(self) -> int:
        return len(self.lines)

    @property
    def waiting_on(self) -> str:
        """Who holds the claim now, for lists (delegation is shown on the claim itself)."""
        if self.status in ("DRAFT", "SENT_BACK", "WITHDRAWN"):
            return self.employee.full_name
        if self.status in ("READY_FOR_PAYROLL", "SENT_TO_PAYROLL"):
            return "Payroll"
        if self.status == "PAYMENT_FAILED":
            return "Finance"
        names = []
        for s in self.steps:
            if s.status == "PENDING":
                names.append(s.approver.full_name if s.approver else ("Finance" if s.level == "FINANCE" else "Unassigned"))
        return ", ".join(dict.fromkeys(names)) or "—"

    @property
    def stage(self) -> str:
        if self.status == "PENDING_APPROVAL":
            levels = {s.level for s in self.steps if s.status == "PENDING"}
            return "Manager approval" if "L1" in levels else "Second approval"
        return {
            "DRAFT": "Draft", "PENDING_FINANCE": "Finance review", "READY_FOR_PAYROLL": "Approved for payment",
            "SENT_TO_PAYROLL": "Approved for payment", "PAYMENT_FAILED": "Payment failed", "PAID": "Paid",
            "SENT_BACK": "Returned", "WITHDRAWN": "Withdrawn", "REJECTED": "Rejected",
        }.get(self.status, self.status)

    @property
    def stage_since(self) -> datetime:
        pending = [s.activated_at for s in self.steps if s.status == "PENDING"]
        return min(pending) if pending else self.updated_at


class ClaimComment(Base):
    __tablename__ = "claim_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    claim: Mapped[Claim] = relationship(back_populates="comments")
    author: Mapped[User] = relationship()


class ClaimLine(Base):
    __tablename__ = "claim_lines"

    id: Mapped[int] = mapped_column(primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    expense_date: Mapped[date] = mapped_column(Date)
    merchant: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))  # full invoice amount incl. GST (FR-5.13)
    approved_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")
    reject_reason: Mapped[str | None] = mapped_column(Text)
    cost_centre: Mapped[str] = mapped_column(String(50), default="")
    state: Mapped[str] = mapped_column(String(50), default="")  # state of expense, picks company GSTIN
    invoice_no: Mapped[str] = mapped_column(String(100), default="")
    supplier_gstin: Mapped[str] = mapped_column(String(15), default="")
    buyer_gstin: Mapped[str] = mapped_column(String(15), default="")
    cgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    sgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    igst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    gst_credit_eligible: Mapped[bool | None] = mapped_column(Boolean)
    extra_field_value: Mapped[str] = mapped_column(Text, default="")
    justification: Mapped[str] = mapped_column(Text, default="")  # employee reason for Flag violations
    receipt_path: Mapped[str | None] = mapped_column(String(300))
    receipt_name: Mapped[str | None] = mapped_column(String(300))
    receipt_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    policy_flags: Mapped[list] = mapped_column(JSONB, default=list)
    duplicate_flags: Mapped[list] = mapped_column(JSONB, default=list)
    duplicate_cleared_reason: Mapped[str | None] = mapped_column(Text)
    # Snapshot of the routing rules on the submit date (FR-2.10)
    l1_approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    l2_rules: Mapped[list] = mapped_column(JSONB, default=list)

    claim: Mapped[Claim] = relationship(back_populates="lines")
    category: Mapped[Category] = relationship()

    @property
    def current_amount(self) -> Decimal:
        return self.approved_amount if self.approved_amount is not None else self.amount


class ApprovalStep(Base):
    """One approval task. L1/L2 steps belong to a line; the FINANCE step belongs to the whole claim.
    approver_id None on a FINANCE step means "any Finance Reviewer" (except the submitter)."""

    __tablename__ = "approval_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("claims.id", ondelete="CASCADE"), index=True)
    line_id: Mapped[int | None] = mapped_column(ForeignKey("claim_lines.id", ondelete="CASCADE"))
    round: Mapped[int] = mapped_column(Integer)
    level: Mapped[str] = mapped_column(String(10))
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # amount the step was asked to approve
    approved_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    acted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    on_behalf_of_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comment: Mapped[str | None] = mapped_column(Text)
    self_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    activated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    escalated: Mapped[bool] = mapped_column(Boolean, default=False)

    claim: Mapped[Claim] = relationship(back_populates="steps")
    line: Mapped[ClaimLine | None] = relationship()
    approver: Mapped[User | None] = relationship(foreign_keys=[approver_id])
    acted_by: Mapped[User | None] = relationship(foreign_keys=[acted_by_id])
    on_behalf_of: Mapped[User | None] = relationship(foreign_keys=[on_behalf_of_id])
