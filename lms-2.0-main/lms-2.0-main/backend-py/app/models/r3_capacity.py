from datetime import date

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin


class BlackoutPeriod(Base, CreatedAtMixin):
    __tablename__ = "blackout_periods"

    blackout_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    leave_type_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("leave_types.leave_type_id"), nullable=True
    )  # null = all types
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)


class TeamCapacityLimit(Base, CreatedAtMixin):
    __tablename__ = "team_capacity_limits"

    capacity_limit_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    manager_employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    max_concurrent_on_leave: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)  # null = enabled/open-ended
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
