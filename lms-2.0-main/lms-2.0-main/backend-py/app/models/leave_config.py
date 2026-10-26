from datetime import date

from sqlalchemy import BigInteger, Boolean, Date, DECIMAL, ForeignKey, SmallInteger, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin, TimestampMixin, UpdatedAtMixin


class LeaveType(Base, TimestampMixin):
    __tablename__ = "leave_types"

    leave_type_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    type_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_sick_leave: Mapped[bool] = mapped_column(Boolean, default=False)  # BR-42/43
    is_balance_affecting: Mapped[bool] = mapped_column(Boolean, default=True)  # LOP = false
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)  # LOP = non-deletable
    is_selectable_by_employee: Mapped[bool] = mapped_column(Boolean, default=True)  # LOP = false
    permits_half_day: Mapped[bool] = mapped_column(Boolean, default=False)
    permits_attachments: Mapped[bool] = mapped_column(Boolean, default=False)
    # 'ALL' | 'FEMALE' | 'MALE'. Configurable per type rather than keyed off type_code, so
    # Paternity can be added and restricted without a code change.
    gender_eligibility: Mapped[str] = mapped_column(String(10), nullable=False, default="ALL", server_default="ALL")


class LeavePolicy(Base, UpdatedAtMixin):
    __tablename__ = "leave_policies"

    policy_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    leave_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("leave_types.leave_type_id"), unique=True, nullable=False
    )
    annual_entitlement: Mapped[float] = mapped_column(DECIMAL(6, 1), nullable=False)
    carries_forward: Mapped[bool] = mapped_column(Boolean, default=False)
    carry_forward_cap: Mapped[float | None] = mapped_column(DECIMAL(6, 1), nullable=True)
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)


class LeaveAccrualConfig(Base, UpdatedAtMixin):
    __tablename__ = "leave_accrual_configs"

    accrual_config_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    leave_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("leave_types.leave_type_id"), unique=True, nullable=False
    )
    accrual_method: Mapped[str] = mapped_column(String(20), nullable=False)  # MONTHLY|QUARTERLY|ANNUAL
    posting_day: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)  # 1-31
    updated_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=True)


class LeaveYear(Base, CreatedAtMixin):
    __tablename__ = "leave_years"

    leave_year_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    year_code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False)  # BR-01/28: closed year never modified


class Holiday(Base, CreatedAtMixin):
    __tablename__ = "holidays"

    holiday_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    holiday_date: Mapped[date] = mapped_column(Date, nullable=False)
    holiday_name: Mapped[str] = mapped_column(String(200), nullable=False)
    leave_year_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_years.leave_year_id"), nullable=False)
    region_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("regions.region_id"), nullable=True
    )  # null = org-wide
    is_optional: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
