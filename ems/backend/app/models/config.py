"""Administrator-owned configuration: categories, policy limits, settings."""
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    kind: Mapped[str] = mapped_column(String(20), default="EXPENSE")  # EXPENSE | ADVANCE
    group_name: Mapped[str] = mapped_column(String(100), default="")  # heading in the category picker
    description: Mapped[str | None] = mapped_column(String(200))  # short note in the picker, e.g. Cab, auto, metro
    gl_code: Mapped[str] = mapped_column(String(50), default="")
    gst_credit_eligible: Mapped[bool] = mapped_column(Boolean, default=False)
    taxable: Mapped[bool] = mapped_column(Boolean, default=False)  # payroll taxable flag (FR-7.7)
    receipt_required: Mapped[bool] = mapped_column(Boolean, default=True)
    receipt_threshold: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # receipt only above this amount
    extra_field_label: Mapped[str | None] = mapped_column(String(100))  # e.g. "Attendees" (FR-5.4)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class PolicyLimit(Base):
    __tablename__ = "policy_limits"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    scope: Mapped[str] = mapped_column(String(20))  # EMPLOYEE | DEPARTMENT | COMPANY
    scope_value: Mapped[str | None] = mapped_column(String(100))  # user id or department
    period: Mapped[str] = mapped_column(String(10))  # LINE | DAY | MONTH | YEAR (financial year)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    action: Mapped[str] = mapped_column(String(10))  # BLOCK | FLAG | WARN
    effective_from: Mapped[date] = mapped_column(Date)
    effective_to: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    category: Mapped[Category] = relationship()


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[object] = mapped_column(JSONB)
