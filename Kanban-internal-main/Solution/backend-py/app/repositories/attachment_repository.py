"""SQL for link attachments on cards and projects (D-069)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppUser, Attachment


@dataclass(frozen=True)
class AttachmentView:
    id: str
    title: str
    url: str
    kind: str | None
    note: str
    added_at: datetime
    user_id: str
    user_name: str
    user_email: str
    user_role: str


@dataclass(frozen=True)
class AttachmentHead:
    id: str
    title: str
    url: str


class AttachmentRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def views(
        self,
        *,
        card_id: str | None = None,
        project_id: str | None = None,
        attachment_id: str | None = None,
    ) -> list[AttachmentView]:
        q = (
            select(
                Attachment.id,
                Attachment.title,
                Attachment.url,
                Attachment.kind,
                Attachment.note,
                Attachment.added_at,
                AppUser.id,
                AppUser.name,
                AppUser.email,
                AppUser.role,
            )
            .join(AppUser, AppUser.id == Attachment.added_by)
            .order_by(Attachment.added_at.desc())
        )
        if card_id:
            q = q.where(Attachment.card_id == card_id)
        if project_id:
            q = q.where(Attachment.project_id == project_id)
        if attachment_id:
            q = q.where(Attachment.id == attachment_id)
        return [AttachmentView(*tuple(r)) for r in await self.db.execute(q)]

    async def head(
        self, attachment_id: str, *, card_id: str | None = None, project_id: str | None = None
    ) -> AttachmentHead | None:
        q = select(Attachment.id, Attachment.title, Attachment.url).where(
            Attachment.id == attachment_id
        )
        q = q.where(Attachment.card_id == card_id) if card_id else q
        q = q.where(Attachment.project_id == project_id) if project_id else q
        row = (await self.db.execute(q)).first()
        return AttachmentHead(*tuple(row)) if row else None

    async def insert(
        self,
        *,
        attachment_id: str,
        card_id: str | None,
        project_id: str | None,
        title: str,
        url: str,
        kind: str | None,
        note: str,
        by: str,
        now: datetime,
    ) -> None:
        await self.db.execute(
            insert(Attachment).values(
                id=attachment_id,
                card_id=card_id,
                project_id=project_id,
                title=title,
                url=url,
                kind=kind,
                note=note,
                added_by=by,
                added_at=now,
            )
        )

    async def delete(self, attachment_id: str) -> None:
        await self.db.execute(delete(Attachment).where(Attachment.id == attachment_id))
