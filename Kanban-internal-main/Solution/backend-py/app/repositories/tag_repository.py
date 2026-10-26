"""SQL for the tag vocabulary (D-062)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tag
from app.repositories.errors import unique_guard


@dataclass(frozen=True)
class TagRow:
    id: str
    name: str
    created_at: datetime


class TagRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def list_all(self) -> list[TagRow]:
        rows = await self.db.execute(
            select(Tag.id, Tag.name, Tag.created_at).order_by(func.lower(Tag.name))
        )
        return [TagRow(*r) for r in rows]

    async def usage_counts(self) -> dict[str, int]:
        """Cards per tag name (org-wide totals, CR-14: numbers only)."""
        rows = await self.db.execute(
            text("SELECT t AS name, count(*) AS n FROM card, unnest(tags) AS t GROUP BY t")
        )
        return {r.name: int(r.n) for r in rows}

    async def get(self, tag_id: str) -> TagRow | None:
        row = (
            await self.db.execute(select(Tag.id, Tag.name, Tag.created_at).where(Tag.id == tag_id))
        ).first()
        return TagRow(*row) if row else None

    async def insert(self, tag_id: str, name: str, now: datetime) -> TagRow:
        async with unique_guard():
            row = (
                await self.db.execute(
                    insert(Tag)
                    .values(id=tag_id, name=name, created_at=now)
                    .returning(Tag.id, Tag.name, Tag.created_at)
                )
            ).one()
        return TagRow(*row)

    async def rename(self, tag_id: str, name: str) -> TagRow:
        async with unique_guard():
            row = (
                await self.db.execute(
                    update(Tag)
                    .where(Tag.id == tag_id)
                    .values(name=name)
                    .returning(Tag.id, Tag.name, Tag.created_at)
                )
            ).one()
        return TagRow(*row)

    async def delete(self, tag_id: str) -> None:
        await self.db.execute(delete(Tag).where(Tag.id == tag_id))

    async def canonical_names(self, names: list[str]) -> dict[str, str]:
        """lower(name) -> the stored spelling, for the requested names that exist."""
        if not names:
            return {}
        lowered = sorted({n.lower() for n in names})
        rows = await self.db.execute(select(Tag.name).where(func.lower(Tag.name).in_(lowered)))
        return {r.name.lower(): r.name for r in rows}
