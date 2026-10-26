"""The two append-only histories: `card_event` (FR-041: every card change, in the same
transaction as the change) and `org_event` (FR-024, D-047: teams, programs, projects, tags).

One write = one or more rows sharing a group id. JSON values are stored as given; `None` is
SQL NULL, as before.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import func, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import AppUser, Card, CardEvent, OrgEvent
from app.repositories.visibility import TIME_FIELDS
from app.utils.ulid import ulid


@dataclass(frozen=True)
class EventInput:
    field: str
    old_value: Any
    new_value: Any


@dataclass(frozen=True)
class OrgEventRow:
    id: str
    group_id: str
    field: str
    old_value: Any
    new_value: Any
    created_at: datetime
    actor_id: str
    actor_name: str
    actor_email: str
    actor_role: str


@dataclass(frozen=True)
class CardEventRow:
    id: str
    group_id: str
    field: str
    old_value: Any
    new_value: Any
    created_at: datetime
    copied_from_number: int | None
    actor_id: str
    actor_name: str
    actor_email: str
    actor_role: str


class EventRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def write_card_events(
        self,
        card_id: str,
        actor_id: str,
        now: datetime,
        events: list[EventInput],
        group_id: str | None = None,
    ) -> str:
        group = group_id or ulid(now)
        if events:
            await self.db.execute(
                insert(CardEvent),
                [
                    {
                        "id": ulid(now),
                        "card_id": card_id,
                        "group_id": group,
                        "field": e.field,
                        "old_value": e.old_value,
                        "new_value": e.new_value,
                        "actor_id": actor_id,
                        "created_at": now,
                        "copied_from_card_id": None,
                    }
                    for e in events
                ],
            )
        return group

    async def write_org_events(
        self,
        entity_type: str,
        entity_id: str,
        actor_id: str,
        now: datetime,
        events: list[EventInput],
        group_id: str | None = None,
    ) -> str:
        group = group_id or ulid(now)
        if events:
            await self.db.execute(
                insert(OrgEvent),
                [
                    {
                        "id": ulid(now),
                        "entity_type": entity_type,
                        "entity_id": entity_id,
                        "group_id": group,
                        "field": e.field,
                        "old_value": e.old_value,
                        "new_value": e.new_value,
                        "actor_id": actor_id,
                        "created_at": now,
                    }
                    for e in events
                ],
            )
        return group

    async def org_event_page(
        self, entity_type: str, entity_id: str, offset: int, limit: int
    ) -> tuple[int, list[OrgEventRow]]:
        where = (OrgEvent.entity_type == entity_type, OrgEvent.entity_id == entity_id)
        total = (
            await self.db.execute(select(func.count()).select_from(OrgEvent).where(*where))
        ).scalar_one()
        rows = await self.db.execute(
            select(
                OrgEvent.id,
                OrgEvent.group_id,
                OrgEvent.field,
                OrgEvent.old_value,
                OrgEvent.new_value,
                OrgEvent.created_at,
                AppUser.id,
                AppUser.name,
                AppUser.email,
                AppUser.role,
            )
            .join(AppUser, AppUser.id == OrgEvent.actor_id)
            .where(*where)
            .order_by(OrgEvent.created_at.desc(), OrgEvent.id.desc())
            .offset(offset)
            .limit(limit)
        )
        return int(total), [OrgEventRow(*r) for r in rows]

    async def card_event_page(
        self,
        card_id: str,
        *,
        field: str | None,
        only_own_time_events_of: str | None,
        offset: int,
        limit: int,
    ) -> tuple[int, list[CardEventRow]]:
        """A card's history, newest first. `only_own_time_events_of`: hide other people's time
        events (CR-13 - they would show their hours)."""
        where: list[Any] = [CardEvent.card_id == card_id]
        if field:
            where.append(CardEvent.field == field)
        if only_own_time_events_of:
            where.append(
                or_(
                    CardEvent.field.not_in(TIME_FIELDS),
                    CardEvent.actor_id == only_own_time_events_of,
                )
            )
        total = (
            await self.db.execute(select(func.count()).select_from(CardEvent).where(*where))
        ).scalar_one()
        src = aliased(Card)
        rows = await self.db.execute(
            select(
                CardEvent.id,
                CardEvent.group_id,
                CardEvent.field,
                CardEvent.old_value,
                CardEvent.new_value,
                CardEvent.created_at,
                src.number,
                AppUser.id,
                AppUser.name,
                AppUser.email,
                AppUser.role,
            )
            .join(AppUser, AppUser.id == CardEvent.actor_id)
            .outerjoin(src, src.id == CardEvent.copied_from_card_id)
            .where(*where)
            .order_by(CardEvent.created_at.desc(), CardEvent.id.desc())
            .offset(offset)
            .limit(limit)
        )
        return int(total), [CardEventRow(*tuple(r)) for r in rows]

    async def copy_card_events(
        self, source_card_id: str, target_card_id: str, ids: list[str], now: datetime
    ) -> int:
        """Carry the named events of one card onto another (D-056), keeping group, actor, time
        and values; returns how many were found."""
        rows = (
            await self.db.execute(
                select(
                    CardEvent.group_id,
                    CardEvent.field,
                    CardEvent.old_value,
                    CardEvent.new_value,
                    CardEvent.actor_id,
                    CardEvent.created_at,
                ).where(CardEvent.card_id == source_card_id, CardEvent.id.in_(ids))
            )
        ).all()
        if rows:
            await self.db.execute(
                insert(CardEvent),
                [
                    {
                        "id": ulid(now),
                        "card_id": target_card_id,
                        "group_id": r.group_id,
                        "field": r.field,
                        "old_value": r.old_value,
                        "new_value": r.new_value,
                        "actor_id": r.actor_id,
                        "created_at": r.created_at,
                        "copied_from_card_id": source_card_id,
                    }
                    for r in rows
                ],
            )
        return len(rows)
