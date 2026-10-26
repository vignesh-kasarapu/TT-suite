"""Comments (D-068): one level of replies, votes, edit/delete by the author.

Comments stay open on a closed card (CR-24) but not in a closed project (CR-12). Votes are not
events and do not bump the card's version.
"""

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    FieldError,
    ForbiddenException,
    NotEmptyException,
    NotFoundException,
    ValidationFailedException,
)
from app.repositories.card_repository import CardRepository, CardRow
from app.repositories.comment_repository import CommentHead, CommentRepository, CommentRow
from app.repositories.event_repository import EventInput, EventRepository
from app.schemas.card_schema import Comment, CommentList
from app.services.card_access_service import CardAccessService
from app.services.card_mapper import key_of, user_wire
from app.services.notify_service import NotifyContext, NotifyService
from app.utils.ulid import ulid


def _dto(c: CommentRow) -> Comment:
    return Comment.model_validate(
        {
            "id": c.id,
            "cardId": c.card_id,
            "author": user_wire(c.author_id, c.author_name, c.author_email, c.author_role),
            "body": c.body,
            "createdAt": c.created_at,
            "editedAt": c.edited_at,
            "copiedFromKey": key_of(c.copied_from_number) if c.copied_from_number else None,
            "parentId": c.parent_id,
            "up": c.up,
            "down": c.down,
            "myVote": c.my_vote,
        }
    )


class CommentService:
    def __init__(
        self,
        uow: UnitOfWork,
        comments: CommentRepository,
        cards: CardRepository,
        events: EventRepository,
        access: CardAccessService,
        notify: NotifyService,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.comments = comments
        self.cards = cards
        self.events = events
        self.access = access
        self.notify = notify
        self.clock = clock

    async def _one(self, actor: Actor, comment_id: str) -> Comment:
        return _dto((await self.comments.list_for(actor.id, comment_id=comment_id))[0])

    async def _own(self, actor: Actor, card: CardRow, comment_id: str) -> CommentHead:
        c = await self.comments.head(card.id, comment_id)
        if c is None:
            raise NotFoundException("No such comment.")
        if c.author_id != actor.id:
            raise ForbiddenException("Only the author can change a comment.")
        return c

    async def list_for(self, actor: Actor, key: str) -> CommentList:
        card = await self.access.load(actor, key)
        rows = await self.comments.list_for(actor.id, card_id=card.id)
        return CommentList(items=[_dto(c) for c in rows])

    async def add(self, actor: Actor, key: str, body: str, parent_id: str | None) -> Comment:
        now = self.clock.now()
        # CR-24: the write check without the closed-card gate.
        card = await self.access.load(actor, key)
        if not await self.access.can_write(actor, card):
            raise ForbiddenException(
                "Only members of the card\N{RIGHT SINGLE QUOTATION MARK}s team can change it."
            )
        await self.access.assert_project_open(card)
        if parent_id:
            # One level only: the parent must be a top-level comment on this card.
            parent = await self.comments.head(card.id, parent_id)
            if parent is None or parent.parent_id is not None:
                raise ValidationFailedException(
                    "Replies go on a top-level comment of this card.",
                    [FieldError("NOT_TOP_LEVEL", "Not a top-level comment here.", "parentId")],
                )
        comment_id = ulid(now)
        await self.comments.insert(
            comment_id=comment_id,
            card_id=card.id,
            author_id=actor.id,
            body=body,
            parent_id=parent_id,
            now=now,
        )
        await self.cards.write(card, {}, now)
        value: dict[str, str] = {"commentId": comment_id, "body": body}
        if parent_id:
            value["parentId"] = parent_id
        await self.events.write_card_events(
            card.id, actor.id, now, [EventInput("comment_added", None, value)]
        )
        await self.notify.enqueue(
            "comment",
            NotifyContext(
                key_of(card.number), card.title, actor.name, body[:200], card.team_id, None
            ),
            now,
        )
        await self.uow.commit()
        return await self._one(actor, comment_id)

    async def edit(self, actor: Actor, key: str, comment_id: str, body: str) -> Comment:
        now = self.clock.now()
        card = await self.access.load(actor, key)
        await self.access.assert_project_open(card)
        c = await self._own(actor, card, comment_id)
        await self.comments.edit(c.id, body, now)
        await self.cards.write(card, {}, now)
        await self.events.write_card_events(
            card.id,
            actor.id,
            now,
            [
                EventInput(
                    "comment_edited",
                    {"commentId": c.id, "body": c.body},
                    {"commentId": c.id, "body": body},
                )
            ],
        )
        await self.uow.commit()
        return await self._one(actor, comment_id)

    async def vote(self, actor: Actor, key: str, comment_id: str, value: int) -> Comment:
        card = await self.access.load(actor, key)
        if await self.comments.head(card.id, comment_id) is None:
            raise NotFoundException("No such comment.")
        await self.comments.set_vote(comment_id, actor.id, value, self.clock.now())
        await self.uow.commit()
        return await self._one(actor, comment_id)

    async def delete(self, actor: Actor, key: str, comment_id: str) -> None:
        now = self.clock.now()
        card = await self.access.load(actor, key)
        await self.access.assert_project_open(card)
        c = await self._own(actor, card, comment_id)
        if await self.comments.has_replies(c.id):
            raise NotEmptyException("This comment has replies; edit it instead of deleting it.")
        await self.comments.delete(c.id)
        await self.cards.write(card, {}, now)
        await self.events.write_card_events(
            card.id,
            actor.id,
            now,
            [EventInput("comment_deleted", {"commentId": c.id, "body": c.body}, None)],
        )
        await self.uow.commit()
