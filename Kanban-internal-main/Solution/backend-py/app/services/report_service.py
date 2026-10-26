"""Reports (D-072, FR-060..062, CR-13) over org cards.

Progress: counts per state, delivered / cancelled / open, effort against logged hours, no-ETA
and overdue, per project, program or person. Cancelled is shown but kept out of the denominator;
"no ETA" is its own bucket; overdue = open with ETA before today in ORG_TZ. Overdue: open cards
past their ETA, grouped. Effort export: hours per person per card per day as CSV, exactly what
the caller may see, safe to open in a spreadsheet.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from app.core.clock import Clock
from app.core.config import Settings
from app.core.security import Actor
from app.exceptions.custom_exceptions import FieldError, ValidationFailedException
from app.repositories.report_repository import ReportRepository
from app.schemas.report_schema import OverdueReport, ProgressReport
from app.services.card_mapper import key_of, num
from app.services.card_service import STATES

NO_GROUP = {"person": "Unassigned", "project": "No project", "program": "No program"}
NO_OVERDUE_GROUP = {"assignee": "Unassigned", "team": "No team", "project": "No project"}
OVERDUE_TABLE = {"team": "team", "project": "project", "assignee": "app_user"}
CSV_HEADER = ["Team", "Project", "Card", "Title", "State", "Person", "Email", "Date", "Hours"]


@dataclass(frozen=True)
class EffortCsv:
    filename: str
    body: str


def csv_field(value: str | int | float | None) -> str:
    """One CSV field: quoted, and a leading = + - @ (or tab/CR) neutralised with an apostrophe
    so a spreadsheet never evaluates it."""
    s = "" if value is None else str(value)
    if s[:1] in ("=", "+", "-", "@", "\t", "\r"):
        s = "'" + s
    return '"' + s.replace('"', '""') + '"'


class ReportService:
    def __init__(self, reports: ReportRepository, settings: Settings, clock: Clock) -> None:
        self.reports = reports
        self.settings = settings
        self.clock = clock

    def _today(self) -> date:
        return date.fromisoformat(self.clock.today(self.settings.ORG_TZ))

    async def progress(
        self,
        actor: Actor,
        group_by: str,
        team_id: str | None,
        program_id: str | None,
        start: date | None = None,
        end: date | None = None,
    ) -> ProgressReport:
        """D-153: an optional period (both ends, the right way round) narrows the cards to
        those created or closed in it and the hours to those logged in it."""
        if (start is None) != (end is None):
            raise ValidationFailedException(
                "Give both ends of the period, or neither.",
                [
                    FieldError(
                        "PERIOD", "Both from and to are needed.", "from" if start is None else "to"
                    )
                ],
            )
        if start is not None and end is not None and start > end:
            raise ValidationFailedException(
                "The start date is after the end date.",
                [FieldError("RANGE", "Must be on or before the end date.", "from")],
            )
        period = (start, end) if start is not None and end is not None else None
        today = self._today()
        rows: dict[str, dict[str, Any]] = {}
        for r in await self.reports.progress(
            actor, group_by, today, team_id, program_id, period, self.settings.ORG_TZ
        ):
            key = r.gid or ""
            row = rows.setdefault(
                key,
                {
                    "id": r.gid,
                    "name": r.gname if r.gname is not None else NO_GROUP[group_by],
                    "targetDate": r.target,
                    "byState": {s: 0 for s in STATES},
                    "open": 0,
                    "delivered": 0,
                    "cancelled": 0,
                    "noEta": 0,
                    "overdue": 0,
                    "effortHours": Decimal(0),
                    "loggedHours": Decimal(0),
                },
            )
            row["byState"][r.state] = r.n
            if r.state == "delivered":
                row["delivered"] += r.n
            elif r.state == "cancelled":
                row["cancelled"] += r.n
            else:
                row["open"] += r.n
            row["noEta"] += r.no_eta
            row["overdue"] += r.overdue
            row["effortHours"] += r.effort or 0
            row["loggedHours"] += r.logged or 0
        for row in rows.values():
            row["effortHours"] = num(row["effortHours"])
            row["loggedHours"] = num(row["loggedHours"])
        return ProgressReport.model_validate(
            {"today": today, "from": start, "to": end, "rows": list(rows.values())}
        )

    async def overdue(self, actor: Actor, group_by: str) -> OverdueReport:
        today = self._today()
        names = await self.reports.names(OVERDUE_TABLE[group_by])
        groups: dict[str, dict[str, Any]] = {}
        for c in await self.reports.overdue(actor, today):
            gid = {"team": c.team_id, "project": c.project_id, "assignee": c.assignee_id}[group_by]
            group = groups.setdefault(
                gid or "",
                {
                    "id": gid,
                    "name": names.get(gid, "?") if gid else NO_OVERDUE_GROUP[group_by],
                    "cards": [],
                },
            )
            group["cards"].append(
                {
                    "id": c.id,
                    "key": key_of(c.number),
                    "title": c.title,
                    "plane": c.plane,
                    "state": c.state,
                    "priority": c.priority,
                    "teamId": c.team_id,
                    "projectId": c.project_id,
                    "assigneeId": c.assignee_id,
                    "eta": c.eta,
                    "closedAt": c.closed_at,
                }
            )
        ordered = sorted(groups.values(), key=lambda g: str(g["name"]))
        return OverdueReport.model_validate({"today": today, "groups": ordered})

    async def effort_csv(
        self,
        actor: Actor,
        team_id: str | None,
        program_id: str | None,
        start: date,
        end: date,
    ) -> EffortCsv:
        """D-097 b: a period is mandatory and must be the right way round."""
        if start > end:
            raise ValidationFailedException(
                "The start date is after the end date.",
                [FieldError("RANGE", "Must be on or before the end date.", "from")],
            )
        rows = await self.reports.effort(actor, team_id, program_id, start, end)
        lines: list[list[str | int | float | None]] = [
            list(CSV_HEADER),
            *[
                [
                    r.team,
                    r.project,
                    key_of(r.number),
                    r.title,
                    r.state,
                    r.person,
                    r.email,
                    r.day.isoformat(),
                    num(r.hours),
                ]
                for r in rows
            ],
        ]
        body = "".join(",".join(csv_field(v) for v in cols) + "\r\n" for cols in lines)
        return EffortCsv(f"effort-{self._today().isoformat()}.csv", body)
