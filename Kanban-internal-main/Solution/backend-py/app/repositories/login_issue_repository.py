"""SQL for stored login issues (D-144)."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppUser, LoginIssue
from app.utils.ulid import ulid


@dataclass(frozen=True)
class LoginIssueRow:
    id: str
    name: str
    email: str
    message: str
    created_at: datetime
    resolved_at: datetime | None
    resolved_by_name: str | None


class LoginIssueRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def add(self, *, name: str, email: str, message: str, now: datetime) -> None:
        await self.db.execute(
            insert(LoginIssue).values(
                id=ulid(now), name=name, email=email, message=message, created_at=now
            )
        )

    async def list_all(self) -> list[LoginIssueRow]:
        """Open ones first, then newest first."""
        rows = await self.db.execute(
            select(
                LoginIssue.id,
                LoginIssue.name,
                LoginIssue.email,
                LoginIssue.message,
                LoginIssue.created_at,
                LoginIssue.resolved_at,
                AppUser.name,
            )
            .outerjoin(AppUser, AppUser.id == LoginIssue.resolved_by)
            .order_by(LoginIssue.resolved_at.is_not(None), LoginIssue.created_at.desc())
        )
        return [LoginIssueRow(*r) for r in rows]

    async def resolve(self, issue_id: str, by: str, now: datetime) -> bool:
        """False when there is no such issue; resolving twice keeps the first resolution."""
        found = await self.db.scalar(select(LoginIssue.id).where(LoginIssue.id == issue_id))
        if found is None:
            return False
        await self.db.execute(
            update(LoginIssue)
            .where(LoginIssue.id == issue_id, LoginIssue.resolved_at.is_(None))
            .values(resolved_at=now, resolved_by=by)
        )
        return True
