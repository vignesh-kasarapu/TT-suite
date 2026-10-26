from sqlalchemy import BigInteger, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import UpdatedAtMixin


class OrganizationConfig(Base, UpdatedAtMixin):
    """Key-value config store — every [CONFIG] value from the FRD lives here,
    never hardcoded in business logic. See services/config.py."""

    __tablename__ = "organization_configs"

    config_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    config_value: Mapped[str] = mapped_column(Text, nullable=False)
    value_type: Mapped[str] = mapped_column(String(20), nullable=False)  # STRING|INT|BOOL|JSON
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    updated_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.user_id"), nullable=True
    )  # null = system-seeded default


class NotificationTemplate(Base, UpdatedAtMixin):
    __tablename__ = "notification_templates"

    template_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    subject_template: Mapped[str] = mapped_column(String(500), nullable=False)
    body_template: Mapped[str] = mapped_column(Text, nullable=False)
    tokens_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)
