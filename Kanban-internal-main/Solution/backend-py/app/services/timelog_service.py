"""The time log (D-116, FR-081..086): a person's week against 8 h a day / 40 h a week, the team
time page for leads, and the Friday reminder and Monday review emails.

Weeks run Monday to Friday in ORG_TZ. A leave or holiday day lowers the week's target by 8 h.
Hours are the person's time entries on org cards (logged on a card or from the My time page -
the same record). A lead sees a member's entries on the lead's team's cards and only a total
for their other teams' cards (D-116 a).
"""

import calendar
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.core.clock import Clock
from app.core.config import Settings
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    FieldError,
    ForbiddenException,
    NotFoundException,
    ValidationFailedException,
)
from app.repositories.notification_repository import NotificationRepository
from app.repositories.timelog_repository import DayOff, Person, TimeLogRepository, WeekEntry
from app.schemas.auth_schema import user_ref
from app.schemas.time_schema import (
    MyWeek,
    TeamWeek,
    TimeMailRunResult,
    TimeTeamList,
)
from app.services.card_mapper import key_of, num
from app.services.report_service import EffortCsv, csv_field

DAY_HOURS = Decimal(8)
WORKDAYS = 5
FRIDAY_AT = time(17, 0)  # FR-084
MONDAY_AT = time(10, 0)  # FR-085


def week_start_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _workdays(start: date, end: date | None = None) -> list[date]:
    """The working days (Monday-Friday) from start to end, inclusive; a week by default."""
    last = end or start + timedelta(days=WORKDAYS - 1)
    days = [start + timedelta(days=i) for i in range((last - start).days + 1)]
    return [d for d in days if d.weekday() < WORKDAYS]


@dataclass(frozen=True)
class Period:
    """A week (Monday-Friday) or a calendar month (D-120)."""

    kind: str
    start: date
    end: date

    @property
    def days(self) -> list[date]:
        return _workdays(self.start, self.end)


def period_of(day: date, month: str | None) -> Period:
    if month:
        y, m = (int(x) for x in month.split("-"))
        return Period("month", date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1]))
    start = week_start_of(day)
    return Period("week", start, start + timedelta(days=WORKDAYS - 1))


def _entry(e: WeekEntry) -> dict[str, object]:
    return {
        "id": e.id,
        "date": e.date,
        "hours": num(e.hours),
        "note": e.note,
        "card": {
            "key": key_of(e.number),
            "title": e.title,
            "teamId": e.team_id,
            "state": e.state,
        },
    }


class _Week:
    """One person's week (or month, D-120): hours per day, days off, total and target."""

    def __init__(
        self,
        start: date,
        entries: list[WeekEntry],
        offs: list[DayOff],
        days: list[date] | None = None,
    ) -> None:
        self.start = start
        self.workdays = days or _workdays(start)
        self.off = {o.date: o.kind for o in offs}
        self.by_day: dict[date, Decimal] = defaultdict(Decimal)
        for e in entries:
            self.by_day[e.date] += e.hours
        self.total = sum(self.by_day.values(), Decimal(0))
        self.target = DAY_HOURS * (len(self.workdays) - len(self.off))

    @property
    def short_by(self) -> Decimal:
        return max(self.target - self.total, Decimal(0))

    def days(self) -> list[dict[str, object]]:
        return [
            {
                "date": d,
                "hours": num(self.by_day.get(d, Decimal(0))),
                "target": 0 if d in self.off else num(DAY_HOURS),
                "dayOff": self.off.get(d),
            }
            for d in self.workdays
        ]


BOM = chr(0xFEFF)  # UTF-8 byte-order mark: Excel then reads accented names correctly


_Row = list[str | int | float | None]


def _slug(name: str) -> str:
    return "-".join("".join(ch if ch.isalnum() else " " for ch in name.lower()).split()) or "team"


def team_csv_of(week: TeamWeek) -> EffortCsv:
    """D-140: one team's time for a week or month, opening straight in Excel: every entry on the
    team's cards, then each person's totals against their target and their week note."""
    head: list[_Row] = [
        ["Team", week.team_name],
        ["Period", f"{week.start.isoformat()} to {week.end.isoformat()}"],
        [],
        ["Date", "Person", "Card", "Card title", "Hours", "Note"],
    ]
    entries: list[_Row] = sorted(
        (
            [e.date.isoformat(), m.user.name, e.card.key, e.card.title, e.hours, e.note]
            for m in week.members
            for e in m.entries
        ),
        key=lambda r: (str(r[0]), str(r[1])),
    )
    totals: list[_Row] = [
        [],
        ["Person", "Lead", "Hours (all teams)", "Other teams", "Target", "Short by", "Week note"],
    ]
    for m in week.members:
        lead = "yes" if m.is_lead else ""
        totals.append(
            [m.user.name, lead, m.total, m.other_teams_hours, m.target, m.short_by, m.note]
        )
    lines = [*head, *entries, *totals]
    body = BOM + "".join(",".join(csv_field(v) for v in row) + "\r\n" for row in lines)
    return EffortCsv(f"time-{_slug(week.team_name)}-{week.start.isoformat()}.csv", body)


class TimeLogService:
    def __init__(
        self,
        uow: UnitOfWork,
        log: TimeLogRepository,
        notifications: NotificationRepository,
        settings: Settings,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.log = log
        self.notifications = notifications
        self.settings = settings
        self.clock = clock

    def _today(self) -> date:
        return self.clock.now().astimezone(ZoneInfo(self.settings.ORG_TZ)).date()

    async def _weeks(
        self, user_ids: list[str], start: date, period: Period | None = None
    ) -> dict[str, _Week]:
        p = period or Period("week", start, start + timedelta(days=WORKDAYS - 1))
        entries = await self.log.entries(user_ids, p.start, p.end)
        offs = await self.log.days_off(user_ids, p.start, p.end)
        return {
            uid: _Week(
                p.start,
                [e for e in entries if e.user_id == uid],
                [o for o in offs if o.user_id == uid],
                p.days,
            )
            for uid in user_ids
        }

    # ---- My time (FR-082)
    async def my_week(self, actor: Actor, day: date | None, month: str | None = None) -> MyWeek:
        p = period_of(day or self._today(), month)
        start = week_start_of(p.start)
        entries = await self.log.entries([actor.id], p.start, p.end)
        week = _Week(p.start, entries, await self.log.days_off([actor.id], p.start, p.end), p.days)
        # The week note belongs to a week; a month shows none (D-120).
        notes = await self.log.notes([actor.id], start) if p.kind == "week" else {}
        return MyWeek.model_validate(
            {
                "period": p.kind,
                "start": p.start,
                "end": p.end,
                "weekStart": start,
                "days": week.days(),
                "total": num(week.total),
                "target": num(week.target),
                "note": notes.get(actor.id, ""),
                "entries": [_entry(e) for e in entries],
            }
        )

    async def set_note(self, actor: Actor, week_start: date, note: str) -> None:
        if week_start.weekday() != 0:
            raise ValidationFailedException(
                "A week starts on a Monday.",
                [FieldError("WEEK_START", "Must be a Monday.", "weekStart")],
            )
        await self.log.set_note(actor.id, week_start, note.strip(), self.clock.now())
        await self.uow.commit()

    async def set_day_off(self, actor: Actor, day: date, kind: str) -> None:
        if day.weekday() >= WORKDAYS:
            raise ValidationFailedException(
                "Only a working day (Monday to Friday) can be a day off.",
                [FieldError("WEEKDAY", "Must be Monday to Friday.", "date")],
            )
        await self.log.set_day_off(actor.id, day, kind, self.clock.now())
        await self.uow.commit()

    async def clear_day_off(self, actor: Actor, day: date) -> None:
        await self.log.clear_day_off(actor.id, day)
        await self.uow.commit()

    # ---- Team time (FR-083)
    async def teams_for(self, actor: Actor) -> TimeTeamList:
        teams = await (self.log.all_teams() if actor.is_admin else self.log.teams_led_by(actor.id))
        return TimeTeamList.model_validate({"items": [{"id": i, "name": n} for i, n in teams]})

    async def team_week(
        self, actor: Actor, team_id: str, day: date | None, month: str | None = None
    ) -> TeamWeek:
        names = dict(await self.log.all_teams())
        if team_id not in names:
            raise NotFoundException("No such team.")
        if not actor.is_admin and team_id not in dict(await self.log.teams_led_by(actor.id)):
            raise ForbiddenException("Only this team's leads and admins can see its time.")
        return await self._team_week(team_id, names[team_id], day, month)

    async def team_csv(
        self, actor: Actor, team_id: str, day: date | None, month: str | None = None
    ) -> EffortCsv:
        """D-140: the Team time page as a CSV, for the same people (the team's leads, admins)."""
        return team_csv_of(await self.team_week(actor, team_id, day, month))

    async def _team_week(
        self, team_id: str, team_name: str, day: date | None, month: str | None = None
    ) -> TeamWeek:
        """A team's week or month - no access check; callers decide who may see it."""
        p = period_of(day or self._today(), month)
        start = week_start_of(p.start)
        members = await self.log.team_members(team_id)
        ids = [m.id for m in members]
        entries = await self.log.entries(ids, p.start, p.end)
        weeks = await self._weeks(ids, p.start, p)
        notes = await self.log.notes(ids, start) if p.kind == "week" else {}
        rows = []
        for m in members:
            mine = [e for e in entries if e.user_id == m.id]
            here = [e for e in mine if e.team_id == team_id]
            other = sum((e.hours for e in mine if e.team_id != team_id), Decimal(0))
            w = weeks[m.id]
            rows.append(
                {
                    "user": user_ref(m.id, m.name, m.email, m.role, m.photo_updated_at),
                    "isLead": m.is_lead,
                    "days": w.days(),
                    "total": num(w.total),
                    "target": num(w.target),
                    "shortBy": num(w.short_by),
                    "otherTeamsHours": num(other),
                    "note": notes.get(m.id, ""),
                    "entries": [_entry(e) for e in here],
                }
            )
        return TeamWeek.model_validate(
            {
                "teamId": team_id,
                "teamName": team_name,
                "period": p.kind,
                "start": p.start,
                "end": p.end,
                "weekStart": start,
                "members": rows,
            }
        )

    # ---- emails (FR-084..086)
    async def run_due(self) -> list[TimeMailRunResult]:
        """Called by the worker every 30 s: runs a job whose moment has come and that has not
        run yet for its week. Friday 17:00 to Sunday: the reminder for this week. Monday 10:00 to
        Tuesday: the review of last week."""
        local = self.clock.now().astimezone(ZoneInfo(self.settings.ORG_TZ))
        start = week_start_of(local.date())
        wd, at = local.weekday(), local.time()
        done = []
        if (wd == 4 and at >= FRIDAY_AT) or wd in (5, 6):
            done.append(await self.run_job("friday_reminder", start))
        if (wd == 0 and at >= MONDAY_AT) or wd == 1:
            done.append(await self.run_job("monday_review", start - timedelta(days=7)))
        return [r for r in done if r.ran]

    async def run_job(self, job: str, week_start: date) -> TimeMailRunResult:
        now = self.clock.now()
        result = {
            "job": job,
            "weekStart": week_start,
            "ran": False,
            "memberMails": 0,
            "leadMails": 0,
            "reports": 0,
        }
        # D-116 h: a review only follows a week that had its Friday reminder, so the first
        # deploy never reviews weeks from before the time log existed.
        if job == "monday_review" and not await self.log.has_run("friday_reminder", week_start):
            return TimeMailRunResult.model_validate(result)
        if not await self.log.claim_run(job, week_start, now):
            return TimeMailRunResult.model_validate(result)
        result["ran"] = True
        memberships = await self.log.memberships()
        teams_of: dict[str, list[str]] = defaultdict(list)
        team_name: dict[str, str] = {}
        leads_of: dict[str, list[str]] = defaultdict(list)
        members_of: dict[str, list[str]] = defaultdict(list)
        for team_id, name, user_id, is_lead in memberships:
            team_name[team_id] = name
            teams_of[user_id].append(team_id)
            members_of[team_id].append(user_id)
            if is_lead:
                leads_of[team_id].append(user_id)
        people_ids = sorted(teams_of)
        people = await self.log.people(people_ids)
        weeks = await self._weeks(people_ids, week_start)
        notes = await self.log.notes(people_ids, week_start)
        base = self.settings.PUBLIC_BASE_URL

        def facts(uid: str) -> dict[str, object]:
            w = weeks[uid]
            return {
                "weekStart": week_start.isoformat(),
                "total": num(w.total),
                "target": num(w.target),
                "shortBy": num(w.short_by),
                "note": notes.get(uid, ""),
            }

        async def mail(to: str, kind: str, payload: dict[str, object]) -> None:
            await self.notifications.enqueue(
                channel="email", target_id=to, kind=kind, payload=payload, now=now
            )

        short = [uid for uid in people_ids if weeks[uid].short_by > 0]
        if job == "friday_reminder":
            for uid in short:
                await mail(uid, "time_reminder", {**facts(uid), "url": f"{base}/time"})
            await self.uow.commit()
            result["memberMails"] = len(short)
            return TimeMailRunResult.model_validate(result)

        member_mails = lead_mails = reports = 0
        for uid in short:
            await mail(uid, "time_shortfall", {**facts(uid), "url": f"{base}/time"})
            member_mails += 1
            told: set[str] = set()
            for team_id in teams_of[uid]:
                for lead in leads_of[team_id]:
                    if lead == uid or lead in told:
                        continue
                    told.add(lead)
                    person: Person = people[uid]
                    await mail(
                        lead,
                        "time_shortfall_lead",
                        {
                            **facts(uid),
                            "personName": person.name,
                            "teamName": team_name[team_id],
                            "url": f"{base}/team-time?team={team_id}",
                        },
                    )
                    lead_mails += 1
        for team_id, leads in leads_of.items():
            rows = [
                {"name": people[uid].name, **facts(uid)}
                for uid in sorted(members_of[team_id], key=lambda u: people[u].name)
            ]
            # D-140: the team's time log for the week rides along as a CSV attachment.
            csv = team_csv_of(await self._team_week(team_id, team_name[team_id], week_start))
            for lead in leads:
                await mail(
                    lead,
                    "time_team_report",
                    {
                        "teamName": team_name[team_id],
                        "weekStart": week_start.isoformat(),
                        "rows": rows,
                        "url": f"{base}/team-time?team={team_id}",
                        "attachment": {"filename": csv.filename, "content": csv.body},
                    },
                )
                reports += 1
        await self.uow.commit()
        result.update(memberMails=member_mails, leadMails=lead_mails, reports=reports)
        return TimeMailRunResult.model_validate(result)

    async def run_now(self, job: str) -> TimeMailRunResult:
        """Dev/test: run a job for the week it would cover at this moment."""
        start = week_start_of(self._today())
        return await self.run_job(job, start if job == "friday_reminder" else start - timedelta(7))
