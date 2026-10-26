"""Delegations, notifications, audit log and payroll batches."""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.user import User


class Delegation(Base):
    """Full handover of approval work from delegator to delegate between two dates (A21-A26)."""

    __tablename__ = "delegations"

    id: Mapped[int] = mapped_column(primary_key=True)
    delegator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    delegate_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(Text, default="")
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    delegator: Mapped[User] = relationship(foreign_keys=[delegator_id])
    delegate: Mapped[User] = relationship(foreign_keys=[delegate_id])


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message: Mapped[str] = mapped_column(Text)
    link: Mapped[str] = mapped_column(String(200), default="")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    """Append-only. A database trigger (first migration) blocks UPDATE and DELETE (FR-4.6)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    on_behalf_of_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(50))
    entity: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str] = mapped_column(String(50), default="")
    claim_id: Mapped[int | None] = mapped_column(Integer, index=True)
    level: Mapped[str | None] = mapped_column(String(10))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    self_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    details: Mapped[dict] = mapped_column(JSONB, default=dict)

    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id])
    on_behalf_of: Mapped[User | None] = relationship(foreign_keys=[on_behalf_of_id])


class PayrollBatch(Base):
    __tablename__ = "payroll_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[str] = mapped_column(String(7))
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    claim_count: Mapped[int] = mapped_column(Integer, default=0)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    recovery_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=0)
    recoveries: Mapped[list] = mapped_column(JSONB, default=list)  # [{claim_no, employee_code, amount}]

    created_by: Mapped[User] = relationship()
