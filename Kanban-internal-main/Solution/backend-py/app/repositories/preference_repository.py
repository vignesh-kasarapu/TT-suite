"""SQL for `user_preference` (one row per person, created on first save)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserPreference


@dataclass(frozen=True)
class PreferenceRow:
    theme: str
    accent: str
    notify_email: bool
    primary_team_id: str | None
    primary_project_id: str | None
    org_order: str
    inbox_window_days: int


class PreferenceRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, user_id: str) -> PreferenceRow | None:
        row = (
            await self.db.execute(
                select(
                    UserPreference.theme,
                    UserPreference.accent,
                    UserPreference.notify_email,
                    UserPreference.primary_team_id,
                    UserPreference.primary_project_id,
                    UserPreference.org_order,
                    UserPreference.inbox_window_days,
                ).where(UserPreference.user_id == user_id)
            )
        ).first()
        return PreferenceRow(*row) if row else None

    async def upsert(self, user_id: str, p: PreferenceRow, now: datetime) -> None:
        values = {
            "theme": p.theme,
            "accent": p.accent,
            "notify_email": p.notify_email,
            "primary_team_id": p.primary_team_id,
            "primary_project_id": p.primary_project_id,
            "org_order": p.org_order,
            "inbox_window_days": p.inbox_window_days,
            "updated_at": now,
        }
        stmt = insert(UserPreference).values(user_id=user_id, **values)
        await self.db.execute(
            stmt.on_conflict_do_update(index_elements=[UserPreference.user_id], set_=values)
        )

    async def insert_defaults(
        self,
        user_id: str,
        *,
        primary_team_id: str | None,
        primary_project_id: str | None,
        now: datetime,
    ) -> None:
        """An invited person's preferences: their first team (and project) as defaults."""
        await self.db.execute(
            insert(UserPreference).values(
                user_id=user_id,
                theme="system",
                accent="linen",
                primary_team_id=primary_team_id,
                primary_project_id=primary_project_id,
                updated_at=now,
            )
        )

    async def primary_team_id(self, user_id: str) -> str | None:
        return (
            await self.db.execute(
                select(UserPreference.primary_team_id).where(UserPreference.user_id == user_id)
            )
        ).scalar_one_or_none()

    async def notify_email(self, user_id: str) -> bool:
        value = (
            await self.db.execute(
                select(UserPreference.notify_email).where(UserPreference.user_id == user_id)
            )
        ).scalar_one_or_none()
        return bool(value)
