from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin


class NotificationDigestPreference(Base):
    """1:1 with Employee — per-Manager daily-digest opt-in flag (LMS-072)."""

    __tablename__ = "notification_digest_preferences"

    preference_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), unique=True, nullable=False)
    digest_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class EmployeeFinalSettlement(Base, CreatedAtMixin):
    """1:1 with Employee — balance snapshot at deactivation, no payment calculation."""

    __tablename__ = "employee_final_settlements"

    settlement_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), unique=True, nullable=False)
    deactivated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    settlement_snapshot_json: Mapped[str] = mapped_column(Text, nullable=False)
    # Nullable since the suite port: a deactivation pushed by the portal (POST
    # /internal/provision with role=null) may have no local acting employee.
    created_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
