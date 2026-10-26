"""SQL for edited email wording (D-141)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MailTemplate


@dataclass(frozen=True)
class TemplateRow:
    kind: str
    subject: str
    body: str
    updated_at: datetime


class MailTemplateRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, kind: str) -> TemplateRow | None:
        row = (
            await self.db.execute(
                select(
                    MailTemplate.kind,
                    MailTemplate.subject,
                    MailTemplate.body,
                    MailTemplate.updated_at,
                ).where(MailTemplate.kind == kind)
            )
        ).first()
        return TemplateRow(*row) if row else None

    async def all(self) -> dict[str, TemplateRow]:
        rows = await self.db.execute(
            select(
                MailTemplate.kind, MailTemplate.subject, MailTemplate.body, MailTemplate.updated_at
            )
        )
        return {r.kind: TemplateRow(*r) for r in rows}

    async def save(self, kind: str, subject: str, body: str, by: str, now: datetime) -> None:
        values = {"subject": subject, "body": body, "updated_at": now, "updated_by": by}
        await self.db.execute(
            insert(MailTemplate)
            .values(kind=kind, **values)
            .on_conflict_do_update(index_elements=[MailTemplate.kind], set_=values)
        )

    async def remove(self, kind: str) -> None:
        await self.db.execute(delete(MailTemplate).where(MailTemplate.kind == kind))
