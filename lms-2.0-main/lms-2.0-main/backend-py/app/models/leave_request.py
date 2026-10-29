from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, DECIMAL, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import TimestampMixin

# The 10-state leave-request lifecycle (kept as a plain string + app-level
# validation, matching Sequelize's `validate: { isIn }` approach — no native
# database ENUM, so adding a state later is a pure application change).
LEAVE_REQUEST_STATES = (
    "DRAFT",
    "PENDING_MANAGER",
    "PENDING_HR",
    "APPROVED",
    "REJECTED",
    "REJECTED_PENDING_WITHDRAWAL",
    "WITHDRAWN",
    "LOP_APPLIED",
    "CANCELLATION_REQUESTED",
    "CANCELLED",
)


class LeaveRequest(Base, TimestampMixin):
    __tablename__ = "leave_requests"

    request_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    leave_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=False)
    leave_year_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_years.leave_year_id"), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_half_day: Mapped[bool] = mapped_column(Boolean, default=False)
    half_day_portion: Mapped[str | None] = mapped_column(String(10), nullable=True)  # FIRST|SECOND
    reason: Mapped[str] = mapped_column(Text, nullable=False)  # hidden from Watchers, BR-42
    state: Mapped[str] = mapped_column(String(40), nullable=False, default="DRAFT")
    deducted_days: Mapped[float | None] = mapped_column(DECIMAL(6, 1), nullable=True)
    is_advance_leave: Mapped[bool] = mapped_column(Boolean, default=False)
    is_long_leave: Mapped[bool] = mapped_column(Boolean, default=False)
    application_timestamp: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    withdrawal_window_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    prior_leave_type_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=True
    )  # set on LOP conversion
    current_approver_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
    # Approved advance leave: days beyond the balance are loss of pay (services/leave_request/advance_lop.py).
    lop_days: Mapped[float | None] = mapped_column(DECIMAL(6, 1), nullable=True)
    lop_status: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)  # PENDING|CONFIRMED|WITHDRAWN
    lop_decision_deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    sla_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Sequelize's `version: 'lock_version'` optimistic-concurrency column (NFR-18).
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __mapper_args__ = {"version_id_col": lock_version}


class LeaveRequestAttachment(Base):
    __tablename__ = "leave_request_attachments"

    attachment_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_requests.request_id"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)  # stored outside web root
    uploaded_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class LeaveRequestApproval(Base):
    __tablename__ = "leave_request_approvals"

    approval_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_requests.request_id"), nullable=False)
    stage: Mapped[str] = mapped_column(String(20), nullable=False)  # MANAGER|HR|CANCELLATION|SELF
    actor_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    on_behalf_of_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.user_id"), nullable=True
    )  # delegate acting for a Manager
    decision: Mapped[str] = mapped_column(String(10), nullable=False)  # APPROVE|REJECT
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)  # mandatory on REJECT (service-enforced)
    decision_timestamp: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
