"""SQL for the `session` table."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppUser, Session


@dataclass(frozen=True)
class SessionWithUser:
    session_id: str
    expires_at: datetime
    revoked_at: datetime | None
    user_id: str
    name: str
    email: str
    role: str
    status: str


class SessionRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def find_with_user(self, session_hash: str) -> SessionWithUser | None:
        row = (
            await self.db.execute(
                select(
                    Session.id,
                    Session.expires_at,
                    Session.revoked_at,
                    AppUser.id,
                    AppUser.name,
                    AppUser.email,
                    AppUser.role,
                    AppUser.status,
                )
                .join(AppUser, AppUser.id == Session.user_id)
                .where(Session.id == session_hash)
            )
        ).first()
        return SessionWithUser(*row) if row else None

    async def insert(
        self, *, session_hash: str, user_id: str, created_at: datetime, expires_at: datetime
    ) -> None:
        self.db.add(
            Session(
                id=session_hash,
                user_id=user_id,
                created_at=created_at,
                expires_at=expires_at,
                revoked_at=None,
            )
        )
        await self.db.flush()

    async def delete(self, session_hash: str) -> None:
        await self.db.execute(delete(Session).where(Session.id == session_hash))

    async def revoke_all(self, user_id: str, now: datetime) -> int:
        """Revoke every live session of a user (deactivation)."""
        res = await self.db.execute(
            update(Session)
            .where(Session.user_id == user_id, Session.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        return int(getattr(res, "rowcount", 0) or 0)
