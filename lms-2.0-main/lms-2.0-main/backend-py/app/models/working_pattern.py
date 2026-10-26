from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin


class WorkingPattern(Base, CreatedAtMixin):
    __tablename__ = "working_patterns"

    working_pattern_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    pattern_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    pattern_name: Mapped[str] = mapped_column(String(100), nullable=False)
    weekend_days: Mapped[str] = mapped_column(String(50), nullable=False)  # JSON/CSV of weekday codes
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class WorkingPatternAssignment(Base, CreatedAtMixin):
    __tablename__ = "working_pattern_assignments"

    assignment_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    working_pattern_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("working_patterns.working_pattern_id"), nullable=False
    )
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    assigned_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)


class ManagerReassignmentLog(Base):
    __tablename__ = "manager_reassignment_log"

    reassignment_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    old_manager_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    new_manager_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    pending_requests_transferred: Mapped[bool] = mapped_column(Boolean, default=False)
    reassigned_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    reassigned_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
