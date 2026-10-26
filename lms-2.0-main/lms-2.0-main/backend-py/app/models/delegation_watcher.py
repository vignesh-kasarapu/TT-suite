from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.mixins import CreatedAtMixin


class Delegation(Base, CreatedAtMixin):
    __tablename__ = "delegations"

    delegation_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    nominator_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    delegate_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    set_by_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Watcher(Base):
    __tablename__ = "watchers"

    watcher_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("leave_requests.request_id"), nullable=False)
    watcher_employee_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.user_id"), nullable=False
    )  # must hold MANAGER/HR_ADMIN
    added_by_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class StandingWatcher(Base):
    __tablename__ = "standing_watchers"

    standing_watcher_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    watched_employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    watcher_employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    from_date: Mapped[date] = mapped_column(Date, nullable=False)
    to_date: Mapped[date] = mapped_column(Date, nullable=False)
    added_by_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
