"""Teams, programs, projects, tags and the append-only org event log (0004, 0005, 0008, 0011,
0012)."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Ulid

TS = DateTime(timezone=True)


class Team(Base):
    __tablename__ = "team"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    # AES-256-GCM, layout iv | tag | ciphertext (app/core/crypto.py).
    teams_webhook_url_enc: Mapped[bytes | None] = mapped_column(LargeBinary)

    __table_args__ = (Index("team_name_idx", func.lower(name), unique=True),)


class TeamMember(Base):
    __tablename__ = "team_member"

    team_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("team.id"), primary_key=True)
    user_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), primary_key=True)
    added_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    added_by: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    is_lead: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    __table_args__ = (Index("team_member_user_idx", "user_id"),)


class Program(Base):
    __tablename__ = "program"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    target_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())

    __table_args__ = (Index("program_name_idx", func.lower(name), unique=True),)


class Project(Base):
    __tablename__ = "project"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    team_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("team.id"), nullable=False)
    program_id: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("program.id"))
    target_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    accepting: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    closed_at: Mapped[datetime | None] = mapped_column(TS)
    closed_by: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("app_user.id"))

    __table_args__ = (
        UniqueConstraint("id", "team_id", name="project_id_team_id_key"),
        Index("project_team_name_idx", "team_id", func.lower(name), unique=True),
        Index("project_program_idx", "program_id"),
        Index("project_open_idx", "team_id", postgresql_where=text("closed_at IS NULL")),
    )


class OrgEvent(Base):
    """Append-only (grants + trigger): never UPDATE or DELETE."""

    __tablename__ = "org_event"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    entity_type: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[str] = mapped_column(Ulid(), nullable=False)
    group_id: Mapped[str] = mapped_column(Ulid(), nullable=False)
    field: Mapped[str] = mapped_column(Text, nullable=False)
    old_value: Mapped[Any] = mapped_column(JSONB(none_as_null=True))
    new_value: Mapped[Any] = mapped_column(JSONB(none_as_null=True))
    actor_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)

    __table_args__ = (Index("org_event_entity_idx", "entity_type", "entity_id", "created_at"),)


class Tag(Base):
    __tablename__ = "tag"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())

    __table_args__ = (Index("tag_name_idx", func.lower(name), unique=True),)
