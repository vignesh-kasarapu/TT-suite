from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, DECIMAL, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin

LEDGER_ENTRY_TYPES = (
    # The whole configured entitlement, granted once per employee/target/leave year.
    "ENTITLEMENT_GRANT",
    # What HR decided an existing employee starts the new policy with.
    "OPENING_BALANCE_ADJUSTMENT",
    # Historical, from the accrual model this replaced. Never posted again, never deleted.
    "OPENING_PRO_RATA_CREDIT",
    "PERIODIC_ACCRUAL_CREDIT",
    "ENTITLEMENT_REVISION_ADJUSTMENT",
    "CARRY_FORWARD_CREDIT",
    "CARRY_FORWARD_LAPSE_DEBIT",
    "LEAVE_DEDUCTION_DEBIT",
    "COMP_OFF_CREDIT",
    "ENCASHMENT_DEBIT",
    # The HR-approved reset that discontinued the old balances, and its reversal. Both are
    # ordinary compensating entries: nothing they offset is ever deleted.
    "BALANCE_RESET_ADJUSTMENT",
    "BALANCE_RESET_REVERSAL",
    "CANCELLATION_RESTORATION_CREDIT",
    "MANUAL_ADJUSTMENT",
)


class LeaveLedger(Base, CreatedAtMixin):
    """Append-only. Balance is NEVER stored directly — always SUM(quantity) (BR-07)."""

    __tablename__ = "leave_ledger"

    entry_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    leave_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=False)
    #: Set when the entry belongs to a shared entitlement pool. The leave type is still
    #: recorded (it is what the employee applied for), but the balance is summed by pool,
    #: so Sick and Casual draw on the same days instead of holding their own.
    pool_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("leave_entitlement_pools.pool_id"), nullable=True
    )
    leave_year_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_years.leave_year_id"), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(40), nullable=False)
    quantity: Mapped[float] = mapped_column(DECIMAL(8, 2), nullable=False)  # signed; 2 dp so 8h = 1 day conversions (0.25, 0.75) store exactly
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
