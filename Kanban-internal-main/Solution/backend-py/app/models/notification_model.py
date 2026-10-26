"""Notification outbox and the dev/test stub mailbox (0008, 0010)."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Index, SmallInteger, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Ulid

TS = DateTime(timezone=True)


class Notification(Base):
    __tablename__ = "notification"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    channel: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[str] = mapped_column(Ulid(), nullable=False)  # user or team, no FK
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[Any] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(TS)
    attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
    last_error: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("notification_pending_idx", "created_at", postgresql_where=text("sent_at IS NULL")),
    )


class MailStubMessage(Base):
    __tablename__ = "mail_stub_message"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    to_email: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
