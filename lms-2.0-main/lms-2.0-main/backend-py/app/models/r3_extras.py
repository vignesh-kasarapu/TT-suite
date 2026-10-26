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
    days_encashed: Mapped[float] = mapped_column(DECIMAL(6, 1), nullable=False)
    ledger_entry_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("leave_ledger.entry_id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # REQUESTED|POSTED|CANCELLED
    requested_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class CompensatoryOffCredit(Base, CreatedAtMixin):
    __tablename__ = "compensatory_off_credits"

    comp_off_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    hours_or_days: Mapped[float] = mapped_column(DECIMAL(6, 1), nullable=False)
    ledger_entry_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("leave_ledger.entry_id"), nullable=True)
    approved_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
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
