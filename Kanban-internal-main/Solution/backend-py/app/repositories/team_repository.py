"""SQL for teams and memberships."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, exists, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppUser, Card, Project, Team, TeamMember
from app.repositories.errors import unique_guard


@dataclass(frozen=True)
class MembershipRow:
    team_id: str
    name: str
    is_lead: bool


@dataclass(frozen=True)
class TeamRow:
    id: str
    name: str
    description: str
    created_at: datetime
    updated_at: datetime
    teams_webhook_url_enc: bytes | None


@dataclass(frozen=True)
class MemberRow:
    id: str
    name: str
    email: str
    role: str
    is_lead: bool
    status: str


_TEAM = (
    Team.id,
    Team.name,
    Team.description,
    Team.created_at,
    Team.updated_at,
    Team.teams_webhook_url_enc,
)


class TeamRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---- membership
    async def team_ids_of(self, user_id: str) -> list[str]:
        rows = await self.db.execute(
            select(TeamMember.team_id).where(TeamMember.user_id == user_id)
        )
        return [r[0] for r in rows]

    async def memberships_of(self, user_id: str) -> list[MembershipRow]:
        rows = await self.db.execute(
            select(Team.id, Team.name, TeamMember.is_lead)
            .join(Team, Team.id == TeamMember.team_id)
            .where(TeamMember.user_id == user_id)
            .order_by(Team.name.asc())
        )
        return [MembershipRow(*r) for r in rows]

    async def is_member(self, user_id: str, team_id: str) -> bool:
        q = select(TeamMember.user_id).where(
            TeamMember.team_id == team_id, TeamMember.user_id == user_id
        )
        return (await self.db.execute(q)).first() is not None

    async def leads_any(self, user_id: str) -> bool:
        """Leads at least one team: the suite role `lead` (SUITE-CONTRACT §3.3)."""
        q = select(TeamMember.user_id).where(
            TeamMember.user_id == user_id, TeamMember.is_lead.is_(True)
        )
        return (await self.db.execute(q.limit(1))).first() is not None

    async def lead_ids(self, team_id: str) -> list[str]:
        q = select(TeamMember.user_id).where(
            TeamMember.team_id == team_id, TeamMember.is_lead.is_(True)
        )
        return [r[0] for r in await self.db.execute(q)]

    async def is_lead(self, user_id: str, team_id: str) -> bool:
        q = select(TeamMember.user_id).where(
            TeamMember.team_id == team_id,
            TeamMember.user_id == user_id,
            TeamMember.is_lead.is_(True),
        )
        return (await self.db.execute(q)).first() is not None

    async def member_count(self, team_id: str) -> int:
        q = select(func.count()).select_from(TeamMember).where(TeamMember.team_id == team_id)
        return int((await self.db.execute(q)).scalar_one())

    async def members(self, team_id: str) -> list[MemberRow]:
        rows = await self.db.execute(
            select(
                AppUser.id,
                AppUser.name,
                AppUser.email,
                AppUser.role,
                TeamMember.is_lead,
                AppUser.status,
            )
            .join(AppUser, AppUser.id == TeamMember.user_id)
            .where(TeamMember.team_id == team_id)
            .order_by(AppUser.name.asc())
        )
        return [MemberRow(*r) for r in rows]

    async def member(self, team_id: str, user_id: str) -> MemberRow | None:
        row = (
            await self.db.execute(
                select(
                    AppUser.id,
                    AppUser.name,
                    AppUser.email,
                    AppUser.role,
                    TeamMember.is_lead,
                    AppUser.status,
                )
                .join(AppUser, AppUser.id == TeamMember.user_id)
                .where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
            )
        ).first()
        return MemberRow(*row) if row else None

    async def add_member(self, team_id: str, user_id: str, added_by: str, now: datetime) -> None:
        await self.db.execute(
            insert(TeamMember).values(
                team_id=team_id, user_id=user_id, added_at=now, added_by=added_by
            )
        )

    async def remove_member(self, team_id: str, user_id: str) -> None:
        await self.db.execute(
            delete(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
        )

    async def set_lead(self, team_id: str, user_id: str, is_lead: bool) -> None:
        await self.db.execute(
            update(TeamMember)
            .where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)
            .values(is_lead=is_lead)
        )

    # ---- teams
    async def list_all(self) -> list[TeamRow]:
        rows = await self.db.execute(select(*_TEAM).order_by(Team.name.asc()))
        return [TeamRow(*r) for r in rows]

    async def get(self, team_id: str) -> TeamRow | None:
        row = (await self.db.execute(select(*_TEAM).where(Team.id == team_id))).first()
        return TeamRow(*row) if row else None

    async def name_ref(self, team_id: str | None) -> dict[str, str] | None:
        if team_id is None:
            return None
        row = (await self.db.execute(select(Team.id, Team.name).where(Team.id == team_id))).first()
        return {"id": row.id, "name": row.name} if row else None

    async def all_refs(self) -> dict[str, dict[str, str]]:
        rows = await self.db.execute(select(Team.id, Team.name))
        return {r.id: {"id": r.id, "name": r.name} for r in rows}

    async def insert(self, *, team_id: str, name: str, description: str, now: datetime) -> TeamRow:
        async with unique_guard():
            row = (
                await self.db.execute(
                    insert(Team)
                    .values(
                        id=team_id,
                        name=name,
                        description=description,
                        created_at=now,
                        updated_at=now,
                    )
                    .returning(*_TEAM)
                )
            ).one()
        return TeamRow(*row)

    async def update(self, team_id: str, values: dict[str, object], now: datetime) -> TeamRow:
        async with unique_guard():
            row = (
                await self.db.execute(
                    update(Team)
                    .where(Team.id == team_id)
                    .values(**values, updated_at=now)
                    .returning(*_TEAM)
                )
            ).one()
        return TeamRow(*row)

    async def has_projects_or_cards(self, team_id: str) -> bool:
        q = select(
            exists(select(Project.id).where(Project.team_id == team_id))
            | exists(select(Card.id).where(Card.team_id == team_id))
        )
        return bool((await self.db.execute(q)).scalar_one())

    async def delete(self, team_id: str) -> None:
        await self.db.execute(delete(TeamMember).where(TeamMember.team_id == team_id))
        await self.db.execute(delete(Team).where(Team.id == team_id))

    async def has_webhook(self, team_id: str) -> bool:
        q = select(Team.teams_webhook_url_enc).where(Team.id == team_id)
        return (await self.db.execute(q)).scalar_one_or_none() is not None

    async def webhook_enc(self, team_id: str) -> bytes | None:
        q = select(Team.teams_webhook_url_enc).where(Team.id == team_id)
        value = (await self.db.execute(q)).scalar_one_or_none()
        return bytes(value) if value is not None else None
