from datetime import date

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin


class SelfApprovalPermission(Base, CreatedAtMixin):
    """At most one ACTIVE grant per employee — checked in services/self_approval_service.py
    (which gives the friendly ACTIVE_GRANT_EXISTS error) and, since the PostgreSQL port,
    backed by a partial unique index so a race cannot create a second active grant.
    Always create through that service, never insert this model directly."""

    __tablename__ = "self_approval_permissions"
    __table_args__ = (
        Index(
            "ux_self_approval_one_active_per_employee", "employee_id",
            unique=True, postgresql_where=text("is_active"),
        ),
    )

    self_approval_permission_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)  # grantee
    granted_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)  # null = open-ended
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
