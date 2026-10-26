"""Cards and everything hanging off them (0003, 0004, 0007, 0008, 0013)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    Sequence,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Ulid

TS = DateTime(timezone=True)

# Standalone sequence (not OWNED BY card.number); the runtime role has USAGE only.
card_number_seq = Sequence("card_number_seq", metadata=Base.metadata)


class Card(Base):
    __tablename__ = "card"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    number: Mapped[int] = mapped_column(
        Integer, nullable=False, unique=True, server_default=card_number_seq.next_value()
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    plane: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'backlog'"))
    owner_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    assignee_id: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("app_user.id"))
    # D-134: none by default.
    priority: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'")
    )
    eta: Mapped[date | None] = mapped_column(Date)
    effort_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    closed_at: Mapped[datetime | None] = mapped_column(TS)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    team_id: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("team.id"))
    project_id: Mapped[str | None] = mapped_column(Ulid())

    __table_args__ = (
        ForeignKeyConstraint(
            ["project_id", "team_id"],
            ["project.id", "project.team_id"],
            name="card_project_team_fk",
            onupdate="CASCADE",
        ),
        Index("card_owner_plane_state_idx", "owner_id", "plane", "state"),
        Index("card_closed_idx", "closed_at", postgresql_where=text("closed_at IS NOT NULL")),
        Index("card_team_state_idx", "team_id", "state", postgresql_where=text("plane = 'org'")),
        Index("card_project_idx", "project_id"),
        Index(
            "card_unassigned_idx",
            "state",
            postgresql_where=text("plane = 'org' AND team_id IS NULL"),
        ),
    )


class CardEvent(Base):
    """Append-only (grants + trigger). FR-041: every card change writes one or more of these in
    the same transaction as the change."""

    __tablename__ = "card_event"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    card_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("card.id"), nullable=False)
    group_id: Mapped[str] = mapped_column(Ulid(), nullable=False)
    field: Mapped[str] = mapped_column(Text, nullable=False)
    old_value: Mapped[Any] = mapped_column(JSONB(none_as_null=True))
    new_value: Mapped[Any] = mapped_column(JSONB(none_as_null=True))
    actor_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    copied_from_card_id: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("card.id"))

    __table_args__ = (
        Index("card_event_card_idx", "card_id", "created_at"),
        Index("card_event_actor_idx", "actor_id", "created_at"),
        Index("card_event_created_idx", "created_at"),
    )


class CardComment(Base):
    __tablename__ = "card_comment"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    card_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("card.id"), nullable=False)
    author_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(TS)
    copied_from_card_id: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("card.id"))
    parent_id: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("card_comment.id"))

    __table_args__ = (
        Index("card_comment_card_idx", "card_id", "created_at"),
        Index("card_comment_parent_idx", "parent_id"),
    )


class CommentVote(Base):
    __tablename__ = "comment_vote"

    comment_id: Mapped[str] = mapped_column(
        Ulid(), ForeignKey("card_comment.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), primary_key=True)
    value: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)


class CardLink(Base):
    __tablename__ = "card_link"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    from_card_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("card.id"), nullable=False)
    to_card_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("card.id"), nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    __table_args__ = (
        UniqueConstraint("from_card_id", "to_card_id", "type"),
        Index("card_link_from_idx", "from_card_id"),
        Index("card_link_to_idx", "to_card_id"),
    )


class Attachment(Base):
    """A link attachment on exactly one of a card or a project (D-069)."""

    __tablename__ = "attachment"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    card_id: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("card.id"))
    project_id: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("project.id"))
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    added_by: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    __table_args__ = (
        Index("attachment_card_idx", "card_id"),
        Index("attachment_project_idx", "project_id"),
    )


class TimeEntry(Base):
    __tablename__ = "time_entry"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    card_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("card.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    __table_args__ = (Index("time_entry_card_idx", "card_id", "date"),)


class InboxRead(Base):
    __tablename__ = "inbox_read"

    user_id: Mapped[str] = mapped_column(
        Ulid(), ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True
    )
    event_id: Mapped[str] = mapped_column(
        Ulid(), ForeignKey("card_event.id", ondelete="CASCADE"), primary_key=True
    )
    read_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
