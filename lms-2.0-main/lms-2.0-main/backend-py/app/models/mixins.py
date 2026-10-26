"""Timestamp mixins — applied per-model to match each table's exact Sequelize
timestamp config (many disable one or both, or rename them; see MIGRATION_PLAN.md
and the model-by-model inventory this was ported from)."""
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class UpdatedAtMixin:
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class TimestampMixin(CreatedAtMixin, UpdatedAtMixin):
    """created_at + updated_at, the Sequelize default when neither is overridden."""
