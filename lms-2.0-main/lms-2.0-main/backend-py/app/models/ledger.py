from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, DECIMAL, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin

LEDGER_ENTRY_TYPES = (
    "OPENING_PRO_RATA_CREDIT",
    "PERIODIC_ACCRUAL_CREDIT",
    "CARRY_FORWARD_CREDIT",
    "CARRY_FORWARD_LAPSE_DEBIT",
    "LEAVE_DEDUCTION_DEBIT",
    "CANCELLATION_RESTORATION_CREDIT",
    "MANUAL_ADJUSTMENT",
)


class LeaveLedger(Base, CreatedAtMixin):
    """Append-only. Balance is NEVER stored directly — always SUM(quantity) (BR-07)."""

    __tablename__ = "leave_ledger"

    entry_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    leave_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=False)
    leave_year_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_years.leave_year_id"), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(40), nullable=False)
    quantity: Mapped[float] = mapped_column(DECIMAL(8, 1), nullable=False)  # signed
    source_reference: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    is_system_actor: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class LopRecord(Base):
    __tablename__ = "lop_records"

    lop_record_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("leave_requests.request_id"), unique=True, nullable=False
    )
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    prior_leave_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=False)
    lop_leave_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    deducted_days: Mapped[float] = mapped_column(DECIMAL(6, 1), nullable=False)
    converted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    converted_by_job_run_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("scheduled_job_runs.job_run_id"), nullable=True
    )
