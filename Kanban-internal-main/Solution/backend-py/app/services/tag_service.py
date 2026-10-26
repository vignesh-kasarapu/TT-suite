"""Tag vocabulary (D-062): admins create, rename and delete tags; every card write resolves its
tags against this list. A rename cascades into every card carrying the old name (one `tags`
event per card, sharing the rename's group); a tag is deleted only when no card uses it."""

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    NameTakenException,
    NotEmptyException,
    NotFoundException,
)
from app.repositories.card_repository import CardRepository
from app.repositories.errors import UniqueViolation
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.tag_repository import TagRepository, TagRow
from app.schemas.org_schema import Tag, TagList
from app.utils.ulid import ulid


def _dto(t: TagRow, card_count: int) -> Tag:
    return Tag(id=t.id, name=t.name, card_count=card_count, created_at=t.created_at)


class TagService:
    def __init__(
        self,
        uow: UnitOfWork,
        tags: TagRepository,
        cards: CardRepository,
        events: EventRepository,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.tags = tags
        self.cards = cards
        self.events = events
        self.clock = clock

    async def _load(self, tag_id: str) -> TagRow:
        t = await self.tags.get(tag_id)
        if t is None:
            raise NotFoundException("No such tag.")
        return t

    async def list_all(self) -> TagList:
        counts = await self.tags.usage_counts()
        return TagList(items=[_dto(t, counts.get(t.name, 0)) for t in await self.tags.list_all()])

    async def create(self, actor: Actor, name: str) -> Tag:
        now = self.clock.now()
        try:
            t = await self.tags.insert(ulid(now), name.strip(), now)
        except UniqueViolation:
            raise NameTakenException("tag") from None
        await self.events.write_org_events(
            "tag", t.id, actor.id, now, [EventInput("created", None, {"name": t.name})]
        )
        await self.uow.commit()
        return _dto(t, 0)

    async def rename(self, actor: Actor, tag_id: str, name: str) -> Tag:
        now = self.clock.now()
        name = name.strip()
        t = await self._load(tag_id)
        if t.name == name:
            return _dto(t, 0)
        try:
            saved = await self.tags.rename(tag_id, name)
        except UniqueViolation:
            raise NameTakenException("tag") from None
        group = await self.events.write_org_events(
            "tag", tag_id, actor.id, now, [EventInput("name", t.name, name)]
        )
        cards = await self.cards.with_tag(t.name)
        for card in cards:
            renamed = [name if x == t.name else x for x in card.tags]
            await self.cards.write(card, {"tags": renamed}, now)
            await self.events.write_card_events(
                card.id, actor.id, now, [EventInput("tags", card.tags, renamed)], group
            )
        await self.uow.commit()
        return _dto(saved, len(cards))

    async def delete(self, actor: Actor, tag_id: str) -> None:
        now = self.clock.now()
        t = await self._load(tag_id)
        if await self.cards.any_with_tag(t.name):
            raise NotEmptyException("The tag is still on cards. Remove it from them first.")
        await self.tags.delete(tag_id)
        await self.events.write_org_events(
            "tag", tag_id, actor.id, now, [EventInput("deleted", {"name": t.name}, None)]
        )
        await self.uow.commit()
