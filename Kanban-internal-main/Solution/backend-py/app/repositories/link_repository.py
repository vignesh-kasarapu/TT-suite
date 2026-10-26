"""SQL for card links (FR-030..033, D-048)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CardLink


@dataclass(frozen=True)
class LinkRow:
    id: str
    from_card_id: str
    to_card_id: str
    type: str
    created_by: str
    created_at: datetime


_COLS = (
    CardLink.id,
    CardLink.from_card_id,
    CardLink.to_card_id,
    CardLink.type,
    CardLink.created_by,
    CardLink.created_at,
)


class LinkRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def exists(self, from_id: str, to_id: str, link_type: str) -> bool:
        q = select(CardLink.id).where(
            CardLink.from_card_id == from_id,
            CardLink.to_card_id == to_id,
            CardLink.type == link_type,
        )
        return (await self.db.execute(q)).first() is not None

    async def insert(
        self, *, link_id: str, from_id: str, to_id: str, link_type: str, by: str, now: datetime
    ) -> LinkRow:
        row = (
            await self.db.execute(
                insert(CardLink)
                .values(
                    id=link_id,
                    from_card_id=from_id,
                    to_card_id=to_id,
                    type=link_type,
                    created_by=by,
                    created_at=now,
                )
                .returning(*_COLS)
            )
        ).one()
        return LinkRow(**row._asdict())

    async def delete(self, link_id: str) -> None:
        await self.db.execute(delete(CardLink).where(CardLink.id == link_id))

    async def of_card(self, card_id: str) -> list[LinkRow]:
        rows = await self.db.execute(
            select(*_COLS)
            .where(or_(CardLink.from_card_id == card_id, CardLink.to_card_id == card_id))
            .order_by(CardLink.created_at.asc())
        )
        return [LinkRow(**r._asdict()) for r in rows]

    async def on_card(self, card_id: str, link_id: str) -> LinkRow | None:
        row = (
            await self.db.execute(
                select(*_COLS).where(
                    CardLink.id == link_id,
                    or_(CardLink.from_card_id == card_id, CardLink.to_card_id == card_id),
                )
            )
        ).first()
        return LinkRow(**row._asdict()) if row else None

    async def depends_on_touching(self, card_ids: list[str]) -> list[LinkRow]:
        if not card_ids:
            return []
        rows = await self.db.execute(
            select(*_COLS).where(
                CardLink.type == "depends_on",
                or_(CardLink.from_card_id.in_(card_ids), CardLink.to_card_id.in_(card_ids)),
            )
        )
        return [LinkRow(**r._asdict()) for r in rows]
