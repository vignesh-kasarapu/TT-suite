"""People, sessions and preferences (migrations 0002, 0006, 0007, 0009, 0010, 0013, 0021)."""

from datetime import datetime

from sqlalchemy import (
    CHAR,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Ulid

TS = DateTime(timezone=True)


class AppUser(Base):
    __tablename__ = "app_user"

    id: Mapped[str] = mapped_column(Ulid(), primary_key=True)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'member'"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    external_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    name_override: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    photo: Mapped[bytes | None] = mapped_column(LargeBinary)
    photo_type: Mapped[str | None] = mapped_column(Text)
    photo_source: Mapped[str | None] = mapped_column(Text)
    photo_updated_at: Mapped[datetime | None] = mapped_column(TS)
    inbox_seen_at: Mapped[datetime | None] = mapped_column(TS)
    invited_at: Mapped[datetime | None] = mapped_column(TS)
    invited_by: Mapped[str | None] = mapped_column(Ulid(), ForeignKey("app_user.id"))
    inbox_cleared_before: Mapped[datetime | None] = mapped_column(TS)
    # 0021: the person's `app.users.id` (TT Suite SSO); empty until first seen through the suite.
    suite_user_id: Mapped[str | None] = mapped_column(Text, unique=True)

    __table_args__ = (
        CheckConstraint("role IN ('member','admin')", name="role"),
        CheckConstraint("status IN ('invited','active','inactive')", name="status"),
        CheckConstraint("photo_type IN ('image/jpeg','image/png','image/webp')", name="photo_type"),
        CheckConstraint("photo_source IN ('user','synced')", name="photo_source"),
        Index("app_user_email_idx", func.lower(email), unique=True),
        Index(
            "app_user_external_idx",
            external_id,
            unique=True,
            postgresql_where=text("external_id IS NOT NULL"),
        ),
    )


class Session(Base):
    """`id` is the SHA-256 hex of the cookie value; the cookie itself is never stored."""

    __tablename__ = "session"

    id: Mapped[str] = mapped_column(CHAR(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(TS, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)

    __table_args__ = (Index("session_user_idx", "user_id"),)


class UserPreference(Base):
    __tablename__ = "user_preference"

    user_id: Mapped[str] = mapped_column(Ulid(), ForeignKey("app_user.id"), primary_key=True)
    theme: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'system'"))
    accent: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'linen'"))
    updated_at: Mapped[datetime] = mapped_column(TS, nullable=False, server_default=func.now())
    notify_email: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    primary_team_id: Mapped[str | None] = mapped_column(
        Ulid(), ForeignKey("team.id", ondelete="SET NULL")
    )
    primary_project_id: Mapped[str | None] = mapped_column(
        Ulid(), ForeignKey("project.id", ondelete="SET NULL")
    )
    org_order: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'team_first'")
    )
    inbox_window_days: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("30")
    )

    __table_args__ = (
        CheckConstraint("theme IN ('light','dark','system')", name="theme"),
        CheckConstraint("org_order IN ('team_first','project_first')", name="org_order"),
        CheckConstraint("inbox_window_days BETWEEN 1 AND 365", name="inbox_window_days"),
    )
