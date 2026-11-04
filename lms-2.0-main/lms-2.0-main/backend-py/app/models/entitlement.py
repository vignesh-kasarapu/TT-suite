"""Shared entitlement pools and temporary balance restrictions.

A **pool** is one entitlement several leave types draw from: Sick and Casual share nine days
rather than holding nine each. Membership is data, not a rule keyed off `type_code`, so HR
can pool any two types without a code change.

A **restriction** holds days back for a period. It is not leave: it never appears as usage,
never reduces the entitlement, and it stops applying the moment its end date passes —
whether or not a job has run (`released_at` is bookkeeping, the dates are the rule).
"""
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, DECIMAL, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin

#: A restriction that was never cancelled still counts only inside its own dates.
RESTRICTION_STATES = ("ACTIVE", "RELEASED", "CANCELLED")


class LeaveEntitlementPool(Base, TimestampMixin):
    __tablename__ = "leave_entitlement_pools"

    pool_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    pool_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    pool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    annual_entitlement: Mapped[float] = mapped_column(DECIMAL(6, 1), nullable=False)
    carries_forward: Mapped[bool] = mapped_column(Boolean, default=False)
    carry_forward_cap: Mapped[float | None] = mapped_column(DECIMAL(6, 1), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)


class LeaveTypePoolMember(Base, CreatedAtMixin):
    """One row per leave type that draws on a pool. The leave type is the primary key: a
    type belongs to at most one pool, so the same days can never be counted twice."""

    __tablename__ = "leave_type_pool_members"

    leave_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("leave_types.leave_type_id"), primary_key=True
    )
    pool_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_entitlement_pools.pool_id"), nullable=False)
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)


class LeaveBalanceRestriction(Base, TimestampMixin):
    """Days held back from the available balance for a period. Never leave taken."""

    __tablename__ = "leave_balance_restrictions"

    restriction_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    # Exactly one of these two is set: a pooled type is restricted at the pool, so the same
    # days are not held back twice.
    leave_type_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=True
    )
    pool_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("leave_entitlement_pools.pool_id"), nullable=True
    )
    leave_year_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_years.leave_year_id"), nullable=False)
    days: Mapped[float] = mapped_column(DECIMAL(6, 1), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="ACTIVE")
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
