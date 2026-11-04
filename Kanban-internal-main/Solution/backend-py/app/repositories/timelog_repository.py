"""SQL for the time log (D-116, FR-081..086): a person's week across org cards, week notes, days
off, team members, and the once-per-week mail runs.

Only time logged on **org** cards counts (FR-081): every query here joins the card and keeps
`plane = 'org'`, so older private-card entries are neither shown nor counted.
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AppUser,
    Card,
    Team,
    TeamMember,
    TimeDayOff,
    TimeEntry,
    TimeMailRun,
    TimeWeekNote,
)


@dataclass(frozen=True)
class WeekEntry:
    id: str
    user_id: str
    date: date
    hours: Decimal
    note: str
    card_id: str
    number: int
    title: str
    team_id: str | None
    state: str


@dataclass(frozen=True)
class Person:
    id: str
    name: str
    email: str
    role: str
    is_lead: bool
    photo_updated_at: datetime | None


@dataclass(frozen=True)
class DayOff:
    """A day somebody is not working, as LMS reports it: approved leave or a holiday."""

    user_id: str
    date: date
    kind: str  # "leave" | "holiday"
    label: str = ""
    #: 1.0 for a whole day, 0.5 when only half the day is leave.
    portion: float = 1.0


class TimeLogRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def entries(self, user_ids: list[str], start: date, end: date) -> list[WeekEntry]:
        """Every org-card entry of these people between start and end (inclusive), by date."""
        if not user_ids:
            return []
        rows = await self.db.execute(
            select(
                TimeEntry.id,
                TimeEntry.user_id,
                TimeEntry.date,
                TimeEntry.hours,
                TimeEntry.note,
                Card.id,
                Card.number,
                Card.title,
                Card.team_id,
                Card.state,
            )
            .join(Card, Card.id == TimeEntry.card_id)
            .where(
                Card.plane == "org",
                TimeEntry.user_id.in_(user_ids),
                TimeEntry.date.between(start, end),
            )
            .order_by(TimeEntry.date.asc(), TimeEntry.created_at.asc())
        )
        # Ten columns: past what SQLAlchemy's typed select() models, so the row is untyped here.
        return [WeekEntry(*tuple(r)) for r in rows]

    async def days_off(self, user_ids: list[str], start: date, end: date) -> list[DayOff]:
        """Days off recorded here before LMS answered that question (0015). Kept so an old
        week still reads the way it did; nothing writes to the table any more."""
        if not user_ids:
            return []
        rows = await self.db.execute(
            select(TimeDayOff.user_id, TimeDayOff.date, TimeDayOff.kind)
            .where(TimeDayOff.user_id.in_(user_ids), TimeDayOff.date.between(start, end))
            .order_by(TimeDayOff.date.asc())
        )
        return [DayOff(*r) for r in rows]

    async def suite_ids(self, user_ids: list[str]) -> dict[str, str]:
        """Kanban user id -> TT Suite user id, for the people the suite knows. Somebody who
        has never signed in through the portal has none, and simply has no days off."""
        if not user_ids:
            return {}
        rows = await self.db.execute(
            select(AppUser.id, AppUser.suite_user_id).where(
                AppUser.id.in_(user_ids), AppUser.suite_user_id.is_not(None)
            )
        )
        return {r[0]: r[1] for r in rows}

    async def notes(self, user_ids: list[str], week_start: date) -> dict[str, str]:
        if not user_ids:
            return {}
        rows = await self.db.execute(
            select(TimeWeekNote.user_id, TimeWeekNote.note).where(
                TimeWeekNote.user_id.in_(user_ids), TimeWeekNote.week_start == week_start
            )
        )
        return {r[0]: r[1] for r in rows}

    async def set_note(self, user_id: str, week_start: date, note: str, now: datetime) -> None:
        """An empty note removes the row."""
        if not note:
            await self.db.execute(
                delete(TimeWeekNote).where(
                    TimeWeekNote.user_id == user_id, TimeWeekNote.week_start == week_start
                )
            )
            return
        stmt = insert(TimeWeekNote).values(
            user_id=user_id, week_start=week_start, note=note, updated_at=now
        )
        await self.db.execute(
            stmt.on_conflict_do_update(
                index_elements=["user_id", "week_start"],
                set_={"note": note, "updated_at": now},
            )
        )

    async def team_members(self, team_id: str) -> list[Person]:
        """Active members of one team, by name."""
        rows = await self.db.execute(
            select(
                AppUser.id,
                AppUser.name,
                AppUser.email,
                AppUser.role,
                TeamMember.is_lead,
                AppUser.photo_updated_at,
            )
            .join(AppUser, AppUser.id == TeamMember.user_id)
            .where(TeamMember.team_id == team_id, AppUser.status == "active")
            .order_by(AppUser.name.asc())
        )
        return [Person(*r) for r in rows]

    async def teams_led_by(self, user_id: str) -> list[tuple[str, str]]:
        rows = await self.db.execute(
            select(Team.id, Team.name)
            .join(TeamMember, TeamMember.team_id == Team.id)
            .where(TeamMember.user_id == user_id, TeamMember.is_lead.is_(True))
            .order_by(Team.name.asc())
        )
        return [(r[0], r[1]) for r in rows]

    async def all_teams(self) -> list[tuple[str, str]]:
        rows = await self.db.execute(select(Team.id, Team.name).order_by(Team.name.asc()))
        return [(r[0], r[1]) for r in rows]

    async def memberships(self) -> list[tuple[str, str, str, bool]]:
        """(team id, team name, user id, is lead) for every active member of every team."""
        rows = await self.db.execute(
            select(Team.id, Team.name, TeamMember.user_id, TeamMember.is_lead)
            .join(TeamMember, TeamMember.team_id == Team.id)
            .join(AppUser, AppUser.id == TeamMember.user_id)
            .where(AppUser.status == "active")
            .order_by(Team.name.asc())
        )
        return [(r[0], r[1], r[2], r[3]) for r in rows]

    async def people(self, user_ids: list[str]) -> dict[str, Person]:
        if not user_ids:
            return {}
        rows = await self.db.execute(
            select(
                AppUser.id, AppUser.name, AppUser.email, AppUser.role, AppUser.photo_updated_at
            ).where(AppUser.id.in_(user_ids))
        )
        return {r[0]: Person(r[0], r[1], r[2], r[3], False, r[4]) for r in rows}

    async def claim_run(self, job: str, week_start: date, now: datetime) -> bool:
        """Record that `job` ran for `week_start`; False when it already had (FR-086)."""
        stmt = (
            insert(TimeMailRun)
            .values(job=job, week_start=week_start, ran_at=now)
            .on_conflict_do_nothing(index_elements=["job", "week_start"])
            .returning(TimeMailRun.job)
        )
        return (await self.db.execute(stmt)).first() is not None

    async def has_run(self, job: str, week_start: date) -> bool:
        q = select(func.count()).where(TimeMailRun.job == job, TimeMailRun.week_start == week_start)
        return int((await self.db.execute(q)).scalar_one()) > 0
