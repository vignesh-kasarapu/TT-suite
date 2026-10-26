"""SQL for card comments and their votes (D-068)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models import AppUser, Card, CardComment, CommentVote
from app.utils.ulid import ulid


@dataclass(frozen=True)
class CommentRow:
    id: str
    card_id: str
    body: str
    created_at: datetime
    edited_at: datetime | None
    parent_id: str | None
    copied_from_number: int | None
    author_id: str
    author_name: str
    author_email: str
    author_role: str
    up: int
    down: int
    my_vote: int


@dataclass(frozen=True)
class CommentHead:
    id: str
    author_id: str
    body: str
    parent_id: str | None


class CommentRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_for(
        self, viewer_id: str, *, card_id: str | None = None, comment_id: str | None = None
    ) -> list[CommentRow]:
        """Comments with vote counts and the viewer's own vote, oldest first."""
        src = aliased(Card)
        votes = CommentVote.__table__.alias("v")
        up = (
            select(func.count())
            .where(votes.c.comment_id == CardComment.id, votes.c.value == 1)
            .scalar_subquery()
        )
        down = (
            select(func.count())
            .where(votes.c.comment_id == CardComment.id, votes.c.value == -1)
            .scalar_subquery()
        )
        mine = func.coalesce(
            select(votes.c.value)
            .where(votes.c.comment_id == CardComment.id, votes.c.user_id == viewer_id)
            .scalar_subquery(),
            0,
        )
        q = (
            select(
                CardComment.id,
                CardComment.card_id,
                CardComment.body,
                CardComment.created_at,
                CardComment.edited_at,
                CardComment.parent_id,
                src.number,
                AppUser.id,
                AppUser.name,
                AppUser.email,
                AppUser.role,
                up,
                down,
                mine,
            )
            .join(AppUser, AppUser.id == CardComment.author_id)
            .outerjoin(src, src.id == CardComment.copied_from_card_id)
            .order_by(CardComment.created_at.asc(), CardComment.id.asc())
        )
        if card_id:
            q = q.where(CardComment.card_id == card_id)
        if comment_id:
            q = q.where(CardComment.id == comment_id)
        return [CommentRow(*tuple(r)) for r in await self.db.execute(q)]

    async def head(self, card_id: str, comment_id: str) -> CommentHead | None:
        row = (
            await self.db.execute(
                select(
                    CardComment.id, CardComment.author_id, CardComment.body, CardComment.parent_id
                ).where(CardComment.id == comment_id, CardComment.card_id == card_id)
            )
        ).first()
        return CommentHead(**row._asdict()) if row else None

    async def has_replies(self, comment_id: str) -> bool:
        q = select(CardComment.id).where(CardComment.parent_id == comment_id).limit(1)
        return (await self.db.execute(q)).first() is not None

    async def insert(
        self,
        *,
        comment_id: str,
        card_id: str,
        author_id: str,
        body: str,
        parent_id: str | None,
        now: datetime,
    ) -> None:
        await self.db.execute(
            insert(CardComment).values(
                id=comment_id,
                card_id=card_id,
                author_id=author_id,
                body=body,
                created_at=now,
                edited_at=None,
                copied_from_card_id=None,
                parent_id=parent_id,
            )
        )

    async def edit(self, comment_id: str, body: str, now: datetime) -> None:
        await self.db.execute(
            update(CardComment).where(CardComment.id == comment_id).values(body=body, edited_at=now)
        )

    async def delete(self, comment_id: str) -> None:
        await self.db.execute(delete(CardComment).where(CardComment.id == comment_id))

    async def set_vote(self, comment_id: str, user_id: str, value: int, now: datetime) -> None:
        if value == 0:
            await self.db.execute(
                delete(CommentVote).where(
                    and_(CommentVote.comment_id == comment_id, CommentVote.user_id == user_id)
                )
            )
            return
        stmt = pg_insert(CommentVote).values(
            comment_id=comment_id, user_id=user_id, value=value, created_at=now
        )
        await self.db.execute(
            stmt.on_conflict_do_update(
                index_elements=[CommentVote.comment_id, CommentVote.user_id],
                set_={"value": value},
            )
        )

    async def copy(
        self, source_card_id: str, target_card_id: str, ids: list[str], now: datetime
    ) -> int:
        """Carry the named comments of one card onto another (D-056); returns how many were
        found. Author, text and times are kept; the copies are marked with their source card."""
        rows = (
            await self.db.execute(
                select(
                    CardComment.author_id,
                    CardComment.body,
                    CardComment.created_at,
                    CardComment.edited_at,
                ).where(CardComment.card_id == source_card_id, CardComment.id.in_(ids))
            )
        ).all()
        if rows:
            await self.db.execute(
                insert(CardComment),
                [
                    {
                        "id": ulid(now),
                        "card_id": target_card_id,
                        "author_id": r.author_id,
                        "body": r.body,
                        "created_at": r.created_at,
                        "edited_at": r.edited_at,
                        "copied_from_card_id": source_card_id,
                        "parent_id": None,
                    }
                    for r in rows
                ],
            )
        return len(rows)
