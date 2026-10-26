"""SQL for the reports (D-072, FR-060..062, CR-13) over org cards.

Scope: a non-admin reports on their own teams' cards plus the team-less ones; an admin on every
org card. Hours: everyone's for admins and the card team's leads, else the caller's own.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import Actor


@dataclass(frozen=True)
class ProgressAgg:
    gid: str | None
    gname: str | None
    target: date | None
    state: str
    n: int
    effort: Decimal | None
    logged: Decimal | None
    no_eta: int
    overdue: int


@dataclass(frozen=True)
class OverdueCard:
    id: str
    number: int
    title: str
    plane: str
    state: str
    priority: int | None
    team_id: str | None
    project_id: str | None
    assignee_id: str | None
    eta: date | None
    closed_at: Any


@dataclass(frozen=True)
class EffortRow:
    team: str | None
    project: str | None
    number: int
    title: str
    state: str
    person: str
    email: str
    day: date
    hours: Decimal


def _scope(actor: Actor) -> str:
    if actor.is_admin:
        return "true"
    return (
        "(c.team_id IS NULL OR c.team_id IN"
        " (SELECT team_id FROM team_member WHERE user_id = :actor))"
    )


def _hours_seen(actor: Actor) -> str:
    if actor.is_admin:
        return "true"
    return (
        "(te.user_id = :actor OR EXISTS (SELECT 1 FROM team_member hm WHERE hm.team_id = c.team_id"
        " AND hm.user_id = :actor AND hm.is_lead))"
    )


_GROUP_COLS = {
    "project": "p.id AS gid, p.name AS gname, p.target_date AS target",
    "program": "pg.id AS gid, pg.name AS gname, pg.target_date AS target",
    "person": "u.id AS gid, u.name AS gname, NULL::date AS target",
}


class ReportRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def progress(
        self,
        actor: Actor,
        group_by: str,
        today: date,
        team_id: str | None,
        program_id: str | None,
        period: tuple[date, date] | None = None,
        org_tz: str = "UTC",
    ) -> list[ProgressAgg]:
        """One row per (group, state). `group_by` is one of the contract's three values.
        D-153: with a period, only cards created or closed in it (org-zone dates) count, and only
        hours logged on its dates."""
        sql = f"""
            SELECT g.gid, g.gname, g.target, g.state, count(*) AS n,
                   sum(g.effort_hours) AS effort, sum(g.logged) AS logged,
                   count(*) FILTER (WHERE g.eta IS NULL AND g.closed_at IS NULL) AS no_eta,
                   count(*) FILTER (WHERE g.eta < :today AND g.closed_at IS NULL) AS overdue
            FROM (
              SELECT {_GROUP_COLS[group_by]}, c.state, c.effort_hours, c.eta, c.closed_at,
                     (SELECT COALESCE(SUM(te.hours), 0) FROM time_entry te
                       WHERE te.card_id = c.id AND {_hours_seen(actor)}
                         AND (CAST(:pfrom AS date) IS NULL
                              OR te.date BETWEEN CAST(:pfrom AS date) AND CAST(:pto AS date))
                     ) AS logged
              FROM card c
              LEFT JOIN project p ON p.id = c.project_id
              LEFT JOIN program pg ON pg.id = p.program_id
              LEFT JOIN app_user u ON u.id = c.assignee_id
              WHERE c.plane = 'org' AND {_scope(actor)}
                AND (CAST(:team AS text) IS NULL OR c.team_id = :team)
                AND (CAST(:program AS text) IS NULL OR pg.id = :program)
                AND (CAST(:pfrom AS date) IS NULL
                     OR CAST(timezone(:tz, c.created_at) AS date)
                        BETWEEN CAST(:pfrom AS date) AND CAST(:pto AS date)
                     OR CAST(timezone(:tz, c.closed_at) AS date)
                        BETWEEN CAST(:pfrom AS date) AND CAST(:pto AS date))
            ) g
            GROUP BY g.gid, g.gname, g.target, g.state
            ORDER BY g.gname NULLS LAST, g.state"""  # noqa: S608 - fixed fragments, values bound
        rows = await self.db.execute(
            text(sql),
            {
                "actor": actor.id,
                "today": today,
                "team": team_id,
                "program": program_id,
                "pfrom": period[0] if period else None,
                "pto": period[1] if period else None,
                "tz": org_tz,
            },
        )
        return [ProgressAgg(*tuple(r)) for r in rows]

    async def overdue(self, actor: Actor, today: date) -> list[OverdueCard]:
        sql = f"""
            SELECT c.id, c.number, c.title, c.plane, c.state, c.priority, c.team_id,
                   c.project_id, c.assignee_id, c.eta, c.closed_at
            FROM card c
            WHERE c.plane = 'org' AND {_scope(actor)}
              AND c.closed_at IS NULL AND c.eta < :today
            ORDER BY c.eta ASC, c.priority ASC NULLS LAST"""  # noqa: S608 - fixed fragments, values bound
        rows = await self.db.execute(text(sql), {"actor": actor.id, "today": today})
        return [OverdueCard(*tuple(r)) for r in rows]

    async def names(self, table: str) -> dict[str, str]:
        """id -> name for team, project or app_user (a fixed table name, never input)."""
        assert table in ("team", "project", "app_user")
        rows = await self.db.execute(text(f"SELECT id, name FROM {table}"))  # noqa: S608
        return {r.id: r.name for r in rows}

    async def effort(
        self,
        actor: Actor,
        team_id: str | None,
        program_id: str | None,
        start: date,
        end: date,
    ) -> list[EffortRow]:
        sql = f"""
            SELECT t.name AS team, p.name AS project, c.number, c.title, c.state,
                   u.name AS person, u.email, te.date, sum(te.hours) AS hours
            FROM time_entry te
            JOIN card c ON c.id = te.card_id
            JOIN app_user u ON u.id = te.user_id
            LEFT JOIN team t ON t.id = c.team_id
            LEFT JOIN project p ON p.id = c.project_id
            WHERE c.plane = 'org' AND {_scope(actor)} AND {_hours_seen(actor)}
              AND (CAST(:team AS text) IS NULL OR c.team_id = :team)
              AND (CAST(:program AS text) IS NULL OR p.program_id = :program)
              AND te.date BETWEEN :start AND :end
            GROUP BY t.name, p.name, c.number, c.title, c.state, u.name, u.email, te.date
            ORDER BY t.name NULLS LAST, p.name NULLS LAST, c.number, u.name, te.date"""  # noqa: S608
        rows = await self.db.execute(
            text(sql),
            {
                "actor": actor.id,
                "team": team_id,
                "program": program_id,
                "start": start,
                "end": end,
            },
        )
        return [EffortRow(*tuple(r)) for r in rows]
