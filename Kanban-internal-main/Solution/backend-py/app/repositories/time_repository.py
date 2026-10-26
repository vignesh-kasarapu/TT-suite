"""SQL for time entries (D-071, FR-043, CR-21)."""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppUser, TimeEntry


@dataclass(frozen=True)
class TimeEntryRow:
    id: str
    card_id: str
    user_id: str
    date: date
    hours: Decimal
    note: str


@dataclass(frozen=True)
class TimeEntryView:
    id: str
    date: date
    hours: Decimal
    note: str
    created_at: datetime
    updated_at: datetime
    user_id: str
    user_name: str
    user_email: str
    user_role: str


class TimeRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def lock_day(self, user_id: str, day: date) -> None:
        """Serialise writers for one (person, date) until the transaction ends (CR-21)."""
        await self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
            {"k": f"time:{user_id}:{day.isoformat()}"},
        )

    async def day_total(self, user_id: str, day: date, exclude_id: str | None = None) -> Decimal:
        q = select(func.coalesce(func.sum(TimeEntry.hours), 0)).where(
            TimeEntry.user_id == user_id, TimeEntry.date == day
        )
        if exclude_id:
            q = q.where(TimeEntry.id != exclude_id)
        return Decimal((await self.db.execute(q)).scalar_one())

    async def get(self, card_id: str, entry_id: str) -> TimeEntryRow | None:
        row = (
            await self.db.execute(
                select(
                    TimeEntry.id,
                    TimeEntry.card_id,
                    TimeEntry.user_id,
                    TimeEntry.date,
                    TimeEntry.hours,
                    TimeEntry.note,
                ).where(TimeEntry.id == entry_id, TimeEntry.card_id == card_id)
            )
        ).first()
        return TimeEntryRow(**row._asdict()) if row else None

    async def insert(
        self,
        *,
        entry_id: str,
        card_id: str,
        user_id: str,
        day: date,
        hours: float,
        note: str,
        now: datetime,
    ) -> None:
        await self.db.execute(
            insert(TimeEntry).values(
                id=entry_id,
                card_id=card_id,
                user_id=user_id,
                date=day,
                hours=hours,
                note=note,
                created_at=now,
                updated_at=now,
            )
        )

    async def update(
        self, entry_id: str, *, day: date, hours: float, note: str, now: datetime
    ) -> None:
        await self.db.execute(
            update(TimeEntry)
            .where(TimeEntry.id == entry_id)
            .values(date=day, hours=hours, note=note, updated_at=now)
        )

    async def delete(self, entry_id: str) -> None:
        await self.db.execute(delete(TimeEntry).where(TimeEntry.id == entry_id))

    async def views(
        self, *, card_id: str | None = None, entry_id: str | None = None
    ) -> list[TimeEntryView]:
        q = (
            select(
                TimeEntry.id,
                TimeEntry.date,
                TimeEntry.hours,
                TimeEntry.note,
                TimeEntry.created_at,
                TimeEntry.updated_at,
                AppUser.id,
                AppUser.name,
                AppUser.email,
                AppUser.role,
            )
            .join(AppUser, AppUser.id == TimeEntry.user_id)
            .order_by(TimeEntry.date.desc(), TimeEntry.created_at.desc())
        )
        if card_id:
            q = q.where(TimeEntry.card_id == card_id)
        if entry_id:
            q = q.where(TimeEntry.id == entry_id)
        return [TimeEntryView(*tuple(r)) for r in await self.db.execute(q)]
