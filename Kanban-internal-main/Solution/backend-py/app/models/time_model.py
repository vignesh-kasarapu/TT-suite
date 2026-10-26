"""Time log (0015, D-116): week notes, days off and the once-per-week mail runs."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Ulid

TS = DateTime(timezone=True)


class TimeWeekNote(Base):
    __tablename__ = "time_week_note"

    user_id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    week_start: Mapped[date] = mapped_column(Date, primary_key=True)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False)


class TimeDayOff(Base):
    __tablename__ = "time_day_off"

    user_id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)


class TimeMailRun(Base):
    __tablename__ = "time_mail_run"

    job: Mapped[str] = mapped_column(Text, primary_key=True)
    week_start: Mapped[date] = mapped_column(Date, primary_key=True)
    ran_at: Mapped[datetime] = mapped_column(TS, nullable=False)
