"""SQL for the notification outbox (D-073): rows are queued in the caller's transaction and a
worker sends them later."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import MailStubMessage, Notification
from app.utils.ulid import ulid

MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class NotificationRow:
    id: str
    channel: str
    target_id: str
    kind: str
    payload: Any
    created_at: datetime
    sent_at: datetime | None
    attempts: int
    last_error: str | None


@dataclass(frozen=True)
class StubMail:
    id: str
    to: str
    subject: str
    body: str
    created_at: datetime


_COLS = (
    Notification.id,
    Notification.channel,
    Notification.target_id,
    Notification.kind,
    Notification.payload,
    Notification.created_at,
    Notification.sent_at,
    Notification.attempts,
    Notification.last_error,
)


class NotificationRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def enqueue(
        self, *, channel: str, target_id: str, kind: str, payload: dict[str, Any], now: datetime
    ) -> None:
        await self.db.execute(
            insert(Notification).values(
                id=ulid(now),
                channel=channel,
                target_id=target_id,
                kind=kind,
                payload=payload,
                created_at=now,
                sent_at=None,
                last_error=None,
            )
        )

    async def pending(self, limit: int = 50) -> list[NotificationRow]:
        """Unsent rows with attempts left, oldest first."""
        rows = await self.db.execute(
            select(*_COLS)
            .where(Notification.sent_at.is_(None), Notification.attempts < MAX_ATTEMPTS)
            .order_by(Notification.created_at.asc())
            .limit(limit)
        )
        return [NotificationRow(*tuple(r)) for r in rows]

    async def recent(self, limit: int = 100) -> list[NotificationRow]:
        rows = await self.db.execute(
            select(*_COLS).order_by(Notification.created_at.desc()).limit(limit)
        )
        return [NotificationRow(*tuple(r)) for r in rows]

    async def mark_sent(self, row: NotificationRow, now: datetime) -> None:
        await self.db.execute(
            update(Notification)
            .where(Notification.id == row.id)
            .values(sent_at=now, attempts=row.attempts + 1, last_error=None)
        )

    async def mark_failed(self, row: NotificationRow, error: str) -> None:
        await self.db.execute(
            update(Notification)
            .where(Notification.id == row.id)
            .values(attempts=row.attempts + 1, last_error=error[:500])
        )

    async def stub_mail(self, *, to: str, subject: str, body: str, now: datetime) -> None:
        """The dev/test mailbox: a "sent" message is a row (D-074)."""
        await self.db.execute(
            insert(MailStubMessage).values(
                id=ulid(now), to_email=to, subject=subject, body=body, created_at=now
            )
        )

    async def stub_mailbox(self, limit: int = 100) -> list[StubMail]:
        rows = await self.db.execute(
            select(
                MailStubMessage.id,
                MailStubMessage.to_email,
                MailStubMessage.subject,
                MailStubMessage.body,
                MailStubMessage.created_at,
            )
            .order_by(MailStubMessage.created_at.desc())
            .limit(limit)
        )
        return [StubMail(r.id, r.to_email, r.subject, r.body, r.created_at) for r in rows]
