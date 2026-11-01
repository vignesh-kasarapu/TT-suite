from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, DECIMAL, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin


class LeaveEncashmentRequest(Base):
    __tablename__ = "leave_encashment_requests"

    encashment_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    leave_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=False)
    leave_year_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_years.leave_year_id"), nullable=False)
    days_encashed: Mapped[float] = mapped_column(DECIMAL(6, 2), nullable=False)
    ledger_entry_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("leave_ledger.entry_id"), nullable=True)
    # REQUESTED -> POSTED | REJECTED. The balance is debited only on POSTED, so a request
    # waiting for HR holds no ledger entry — it only reserves days (encashment_service).
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    requested_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class CompensatoryOffCredit(Base, CreatedAtMixin):
    """One request for compensatory off, and — once HR approves it — the credit itself.

    Two approval stages (PENDING_MANAGER -> PENDING_HR -> APPROVED, or REJECTED at either),
    mirroring how a leave request is routed. `hours_worked` is what the employee claims;
    `hours_or_days` is the converted day figure (8 hours = 1 day) and is what reaches the
    ledger, but only after the HR stage.
    """

    __tablename__ = "compensatory_off_credits"

    comp_off_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    hours_worked: Mapped[float | None] = mapped_column(DECIMAL(6, 2), nullable=True)
    hours_or_days: Mapped[float] = mapped_column(DECIMAL(6, 2), nullable=False)
    # The leave year the WORK falls in, not the one current when HR gets round to approving.
    leave_year_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("leave_years.leave_year_id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="APPROVED")
    ledger_entry_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("leave_ledger.entry_id"), nullable=True)
    requested_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    manager_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    manager_decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    manager_comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    hr_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    hr_decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hr_comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Kept from the credit-only era: the HR approver, filled on final approval.
    approved_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class CalendarFeedSubscription(Base, CreatedAtMixin):
    __tablename__ = "calendar_feed_subscriptions"

    subscription_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    feed_token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)  # OWN|TEAM
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class OptionalHolidaySelection(Base):
    __tablename__ = "optional_holiday_selections"

    selection_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    holiday_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("holidays.holiday_id"), nullable=False)
    leave_year_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_years.leave_year_id"), nullable=False)
    selected_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
