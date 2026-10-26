"""SQL for programs and projects."""

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import delete as sa_delete
from sqlalchemy import exists, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Card, Program, Project
from app.repositories.errors import unique_guard


@dataclass(frozen=True)
class ProgramRow:
    id: str
    name: str
    description: str
    target_date: date | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class ProjectRow:
    id: str
    name: str
    description: str
    team_id: str
    program_id: str | None
    target_date: date | None
    created_at: datetime
    updated_at: datetime
    accepting: bool
    closed_at: datetime | None
    closed_by: str | None


@dataclass(frozen=True)
class CardCounts:
    total: int
    open: int


_PROGRAM = (
    Program.id,
    Program.name,
    Program.description,
    Program.target_date,
    Program.created_at,
    Program.updated_at,
)
_PROJECT = (
    Project.id,
    Project.name,
    Project.description,
    Project.team_id,
    Project.program_id,
    Project.target_date,
    Project.created_at,
    Project.updated_at,
    Project.accepting,
    Project.closed_at,
    Project.closed_by,
)


class ProjectRepository:
    """Programs and projects live together: a project's program is part of its row."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---- programs
    async def programs(self) -> list[ProgramRow]:
        rows = await self.db.execute(select(*_PROGRAM).order_by(Program.name.asc()))
        return [ProgramRow(*r) for r in rows]

    async def program(self, program_id: str) -> ProgramRow | None:
        row = (await self.db.execute(select(*_PROGRAM).where(Program.id == program_id))).first()
        return ProgramRow(*row) if row else None

    async def program_ref(self, program_id: str | None) -> dict[str, str] | None:
        if program_id is None:
            return None
        row = (
            await self.db.execute(select(Program.id, Program.name).where(Program.id == program_id))
        ).first()
        return {"id": row.id, "name": row.name} if row else None

    async def program_refs(self) -> dict[str, dict[str, str]]:
        rows = await self.db.execute(select(Program.id, Program.name))
        return {r.id: {"id": r.id, "name": r.name} for r in rows}

    async def program_stats(self, program_id: str) -> tuple[int, date | None]:
        """(number of projects, latest project target date)."""
        row = (
            await self.db.execute(
                select(func.count(), func.max(Project.target_date)).where(
                    Project.program_id == program_id
                )
            )
        ).one()
        return int(row[0]), row[1]

    async def insert_program(
        self, *, program_id: str, name: str, description: str, target: date | None, now: datetime
    ) -> ProgramRow:
        async with unique_guard():
            row = (
                await self.db.execute(
                    insert(Program)
                    .values(
                        id=program_id,
                        name=name,
                        description=description,
                        target_date=target,
                        created_at=now,
                        updated_at=now,
                    )
                    .returning(*_PROGRAM)
                )
            ).one()
        return ProgramRow(*row)

    async def update_program(
        self, program_id: str, values: dict[str, object], now: datetime
    ) -> ProgramRow:
        async with unique_guard():
            row = (
                await self.db.execute(
                    update(Program)
                    .where(Program.id == program_id)
                    .values(**values, updated_at=now)
                    .returning(*_PROGRAM)
                )
            ).one()
        return ProgramRow(*row)

    async def program_has_projects(self, program_id: str) -> bool:
        q = select(exists(select(Project.id).where(Project.program_id == program_id)))
        return bool((await self.db.execute(q)).scalar_one())

    async def delete_program(self, program_id: str) -> None:
        await self.db.execute(sa_delete(Program).where(Program.id == program_id))

    async def projects_ending_after(
        self, program_id: str, end: date
    ) -> list[tuple[str, date | None]]:
        rows = await self.db.execute(
            select(Project.id, Project.target_date)
            .where(Project.program_id == program_id, Project.target_date > end)
            .order_by(Project.target_date.desc())
        )
        return [(r.id, r.target_date) for r in rows]

    # ---- projects
    async def team_id_of(self, project_id: str) -> str | None:
        return (
            await self.db.execute(select(Project.team_id).where(Project.id == project_id))
        ).scalar_one_or_none()

    async def project(self, project_id: str) -> ProjectRow | None:
        row = (await self.db.execute(select(*_PROJECT).where(Project.id == project_id))).first()
        return ProjectRow(*tuple(row)) if row else None

    async def projects(
        self,
        *,
        team_id: str | None = None,
        program_id: str | None = None,
        include_closed: bool = True,
    ) -> list[ProjectRow]:
        q = select(*_PROJECT).order_by(Project.name.asc())
        if team_id:
            q = q.where(Project.team_id == team_id)
        if program_id:
            q = q.where(Project.program_id == program_id)
        if not include_closed:
            q = q.where(Project.closed_at.is_(None))
        return [ProjectRow(*tuple(r)) for r in await self.db.execute(q)]

    async def card_counts(self, project_ids: list[str]) -> dict[str, CardCounts]:
        if not project_ids:
            return {}
        rows = await self.db.execute(
            select(
                Card.project_id,
                func.count(),
                func.count().filter(Card.closed_at.is_(None)),
            )
            .where(Card.project_id.in_(project_ids))
            .group_by(Card.project_id)
        )
        return {str(r[0]): CardCounts(int(r[1]), int(r[2])) for r in rows}

    async def insert_project(self, values: dict[str, object]) -> ProjectRow:
        async with unique_guard():
            row = (
                await self.db.execute(insert(Project).values(**values).returning(*_PROJECT))
            ).one()
        return ProjectRow(*tuple(row))

    async def update_project(
        self, project_id: str, values: dict[str, object], now: datetime
    ) -> ProjectRow:
        async with unique_guard():
            row = (
                await self.db.execute(
                    update(Project)
                    .where(Project.id == project_id)
                    .values(**values, updated_at=now)
                    .returning(*_PROJECT)
                )
            ).one()
        return ProjectRow(*tuple(row))

    async def delete_project(self, project_id: str) -> None:
        await self.db.execute(sa_delete(Project).where(Project.id == project_id))

    async def placement(self, project_id: str) -> tuple[str, str, bool, datetime | None] | None:
        """(id, team_id, accepting, closed_at) - what card placement checks (CR-12)."""
        row = (
            await self.db.execute(
                select(Project.id, Project.team_id, Project.accepting, Project.closed_at).where(
                    Project.id == project_id
                )
            )
        ).first()
        return (row.id, row.team_id, row.accepting, row.closed_at) if row else None

    async def name_ref(self, project_id: str | None) -> dict[str, str] | None:
        if project_id is None:
            return None
        row = (
            await self.db.execute(select(Project.id, Project.name).where(Project.id == project_id))
        ).first()
        return {"id": row.id, "name": row.name} if row else None

    async def closed_at(self, project_id: str) -> datetime | None:
        return (
            await self.db.execute(select(Project.closed_at).where(Project.id == project_id))
        ).scalar_one_or_none()
