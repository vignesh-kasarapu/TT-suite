"""Time entries (D-071, FR-043): logging needs write access to the card; editing and deleting
are the author's own. Every write is a card event and bumps the version. Nobody logs more than
24 h on one date across all cards (CR-21); admins and the card team's leads see everyone's
entries, anyone else only their own (CR-13). Time is logged on org cards only (D-116)."""

from datetime import date
from decimal import Decimal

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    FieldError,
    ForbiddenException,
    NotFoundException,
    PrivateCardTimeException,
    ValidationFailedException,
)
from app.repositories.card_repository import CardRepository
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.time_repository import TimeEntryRow, TimeEntryView, TimeRepository
from app.schemas.card_schema import TimeEntry, TimeEntryBody, TimeEntryList
from app.services.card_access_service import CardAccessService
from app.services.card_mapper import num, user_wire
from app.utils.ulid import ulid

DAY_CAP = 24


def _dto(e: TimeEntryView) -> TimeEntry:
    return TimeEntry.model_validate(
        {
            "id": e.id,
            "user": user_wire(e.user_id, e.user_name, e.user_email, e.user_role),
            "date": e.date,
            "hours": num(e.hours),
            "note": e.note,
            "createdAt": e.created_at,
            "updatedAt": e.updated_at,
        }
    )


class TimeService:
    def __init__(
        self,
        uow: UnitOfWork,
        entries: TimeRepository,
        cards: CardRepository,
        teams: TeamRepository,
        events: EventRepository,
        access: CardAccessService,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.entries = entries
        self.cards = cards
        self.teams = teams
        self.events = events
        self.access = access
        self.clock = clock

    async def _assert_day_cap(
        self, user_id: str, day: date, hours: float, exclude_id: str | None = None
    ) -> None:
        """CR-21: refuse an entry that would take the person's total for `day` past 24 h. The
        advisory lock serialises writers for one (person, date) until the transaction ends."""
        await self.entries.lock_day(user_id, day)
        logged = await self.entries.day_total(user_id, day, exclude_id)
        if logged + Decimal(str(hours)) > DAY_CAP:
            shown = num(logged)
            d = day.isoformat()
            raise ValidationFailedException(
                f"You already have {shown} h logged on {d}; a day holds at most {DAY_CAP} h.",
                [
                    FieldError(
                        "DAY_CAP",
                        f"At most {num(DAY_CAP - logged)} h more can be logged on {d}.",
                        "hours",
                    )
                ],
            )

    async def _own(self, actor: Actor, card_id: str, entry_id: str) -> TimeEntryRow:
        e = await self.entries.get(card_id, entry_id)
        if e is None:
            raise NotFoundException("No such time entry.")
        if e.user_id != actor.id:
            raise ForbiddenException("Only the author can change a time entry.")
        return e

    async def list_for(self, actor: Actor, key: str) -> TimeEntryList:
        card = await self.access.load(actor, key)
        if card.plane != "org":  # D-116: private cards carry no time
            return TimeEntryList.model_validate({"total": 0, "scope": "own", "items": []})
        sees_all = actor.is_admin or (
            card.team_id is not None and await self.teams.is_lead(actor.id, card.team_id)
        )
        rows = [
            e
            for e in await self.entries.views(card_id=card.id)
            if sees_all or e.user_id == actor.id
        ]
        total = sum((e.hours for e in rows), Decimal(0))
        return TimeEntryList.model_validate(
            {
                "total": num(total),
                "scope": "all" if sees_all else "own",
                "items": [_dto(e) for e in rows],
            }
        )

    async def add(self, actor: Actor, key: str, body: TimeEntryBody) -> TimeEntry:
        now = self.clock.now()
        card = await self.access.load_writable(actor, key)
        if card.plane != "org":  # D-116: time is logged on org cards only
            raise PrivateCardTimeException()
        if not self.access.loggable(actor, card, await self.access.lead_team_ids(actor)):
            raise ForbiddenException(
                "Only the person working on this card (or a lead of its team) can log time on it."
            )
        await self._assert_day_cap(actor.id, body.date, body.hours)
        entry_id = ulid(now)
        await self.entries.insert(
            entry_id=entry_id,
            card_id=card.id,
            user_id=actor.id,
            day=body.date,
            hours=body.hours,
            note=body.note or "",
            now=now,
        )
        await self.cards.write(card, {}, now)
        await self.events.write_card_events(
            card.id,
            actor.id,
            now,
            [
                EventInput(
                    "time_logged",
                    None,
                    {"entryId": entry_id, "date": body.date.isoformat(), "hours": num(body.hours)},
                )
            ],
        )
        await self.uow.commit()
        return _dto((await self.entries.views(entry_id=entry_id))[0])

    async def edit(self, actor: Actor, key: str, entry_id: str, body: TimeEntryBody) -> TimeEntry:
        now = self.clock.now()
        card = await self.access.load(actor, key)
        await self.access.assert_open(card)  # CR-24/CR-12: authorised by authorship
        e = await self._own(actor, card.id, entry_id)
        await self._assert_day_cap(actor.id, body.date, body.hours, e.id)
        await self.entries.update(
            e.id,
            day=body.date,
            hours=body.hours,
            note=body.note if body.note is not None else e.note,
            now=now,
        )
        await self.cards.write(card, {}, now)
        await self.events.write_card_events(
            card.id,
            actor.id,
            now,
            [
                EventInput(
                    "time_edited",
                    {"entryId": e.id, "date": e.date.isoformat(), "hours": num(e.hours)},
                    {"entryId": e.id, "date": body.date.isoformat(), "hours": num(body.hours)},
                )
            ],
        )
        await self.uow.commit()
        return _dto((await self.entries.views(entry_id=entry_id))[0])

    async def delete(self, actor: Actor, key: str, entry_id: str) -> None:
        now = self.clock.now()
        card = await self.access.load(actor, key)
        await self.access.assert_open(card)
        e = await self._own(actor, card.id, entry_id)
        await self.entries.delete(e.id)
        await self.cards.write(card, {}, now)
        await self.events.write_card_events(
            card.id,
            actor.id,
            now,
            [
                EventInput(
                    "time_deleted",
                    {"entryId": e.id, "date": e.date.isoformat(), "hours": num(e.hours)},
                    None,
                )
            ],
        )
        await self.uow.commit()
