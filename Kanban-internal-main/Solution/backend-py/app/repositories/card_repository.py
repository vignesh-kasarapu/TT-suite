"""SQL for card rows.

Every read that serves a person goes through `_visible(actor)`: private cards to their owner
only, org cards per `org_readable` (CR-14), with `logged_hours` summed over the time entries the
actor may see (CR-13) - all in one statement, so boards, search and counts agree.

Writes bump `version` and `updated_at`; the caller writes the matching card events in the same
transaction (FR-041).
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import (
    ColumnElement,
    Select,
    Text,
    case,
    cast,
    exists,
    func,
    insert,
    literal,
    or_,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import Actor
from app.models import Card, CardComment, Project, Team, TimeEntry
from app.repositories.visibility import card_readable, my_team_ids, org_readable, sees_all_hours


@dataclass(frozen=True)
class CardRow:
    id: str
    number: int
    title: str
    description: str
    plane: str
    state: str
    owner_id: str
    assignee_id: str | None
    priority: int | None
    tags: list[str]
    eta: date | None
    effort_hours: Decimal | None
    closed_at: datetime | None
    version: int
    created_at: datetime
    updated_at: datetime
    team_id: str | None
    project_id: str | None
    logged_hours: Decimal = Decimal(0)


# The org services name it by its M2 role; it is the same row.
CardBrief = CardRow

_COLS = (
    Card.id,
    Card.number,
    Card.title,
    Card.description,
    Card.plane,
    Card.state,
    Card.owner_id,
    Card.assignee_id,
    Card.priority,
    Card.tags,
    Card.eta,
    Card.effort_hours,
    Card.closed_at,
    Card.version,
    Card.created_at,
    Card.updated_at,
    Card.team_id,
    Card.project_id,
)

BoardKind = Literal["private", "mine", "team", "unassigned", "no_team"]


@dataclass(frozen=True)
class CardFilter:
    include_closed: bool = True
    closed_since: datetime | None = None  # boards: closed cards only when closed after this
    text: str | None = None
    plane: str | None = None
    team_id: str | None = None
    project_id: str | None = None
    program_id: str | None = None
    assignee_id: str | None = None
    state: str | None = None
    tag: str | None = None
    priority: int | None = None


def _row(r: Any) -> CardRow:
    return CardRow(*tuple(r))


def _logged_hours(actor: Actor) -> Any:
    return (
        select(func.coalesce(func.sum(TimeEntry.hours), 0))
        .where(
            TimeEntry.card_id == Card.id,
            or_(TimeEntry.user_id == actor.id, sees_all_hours(actor, Card.team_id)),
        )
        .scalar_subquery()
    )


def _escape_like(s: str) -> str:
    return "%" + s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _text_match(text: str) -> ColumnElement[bool]:
    """Case-insensitive match on key, title or tag (FR-050/056)."""
    like = _escape_like(text)
    tag = func.unnest(Card.tags).table_valued("t").render_derived(name="tg")
    return or_(
        Card.title.ilike(like, escape="\\"),
        (literal("K-") + cast(Card.number, Text)).ilike(like, escape="\\"),
        exists(select(1).select_from(tag).where(tag.c.t.ilike(like, escape="\\"))),
    )


class CardRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    def _visible(self, actor: Actor) -> Select[Any]:
        q: Select[Any] = select(*_COLS, _logged_hours(actor))  # type: ignore[assignment]
        return q.where(card_readable(actor, Card.plane, Card.owner_id, Card.team_id))

    # ---- reads scoped to the actor
    async def visible_by_number(self, actor: Actor, number: int) -> CardRow | None:
        row = (await self.db.execute(self._visible(actor).where(Card.number == number))).first()
        return _row(row) if row else None

    async def visible_by_ids(self, actor: Actor, ids: list[str]) -> dict[str, CardRow]:
        if not ids:
            return {}
        rows = await self.db.execute(self._visible(actor).where(Card.id.in_(ids)))
        return {r.id: _row(r) for r in rows}

    async def visible_in_projects(self, actor: Actor, project_ids: list[str]) -> list[CardRow]:
        if not project_ids:
            return []
        q = self._visible(actor).where(Card.project_id.in_(project_ids)).order_by(Card.number)
        return [_row(r) for r in await self.db.execute(q)]

    async def hidden_org_team(self, number: int) -> str | None:
        """CR-28: the team name of an org card with this number, if there is one."""
        return (
            await self.db.execute(
                select(Team.name)
                .join(Card, Card.team_id == Team.id)
                .where(Card.number == number, Card.plane == "org")
            )
        ).scalar_one_or_none()

    async def unreadable_org_teams(self, actor: Actor, numbers: list[int]) -> dict[int, str]:
        """CR-28: for org card numbers the actor may not read, the owning team's name."""
        if not numbers:
            return {}
        rows = await self.db.execute(
            select(Card.number, Team.name)
            .join(Team, Team.id == Card.team_id)
            .where(
                Card.number.in_(numbers),
                Card.plane == "org",
                ~org_readable(actor, Card.team_id),
            )
        )
        return {int(r.number): str(r.name) for r in rows}

    def _filtered(self, q: Select[Any], f: CardFilter) -> Select[Any]:
        if f.closed_since is not None:
            q = q.where(or_(Card.closed_at.is_(None), Card.closed_at > f.closed_since))
        if not f.include_closed:
            q = q.where(Card.closed_at.is_(None))
        if f.text:
            q = q.where(_text_match(f.text))
        if f.plane:
            q = q.where(Card.plane == f.plane)
        if f.team_id:
            q = q.where(Card.team_id == f.team_id)
        if f.project_id:
            q = q.where(Card.project_id == f.project_id)
        if f.program_id:
            q = q.where(
                Card.project_id.in_(select(Project.id).where(Project.program_id == f.program_id))
            )
        if f.assignee_id:
            q = q.where(Card.assignee_id == f.assignee_id)
        if f.state:
            q = q.where(Card.state == f.state)
        if f.tag:
            q = q.where(Card.tags.contains([f.tag]))
        if f.priority:
            q = q.where(Card.priority == f.priority)
        return q

    async def board(
        self, actor: Actor, kind: BoardKind, f: CardFilter, team_id: str | None = None
    ) -> list[CardRow]:
        q = self._visible(actor)
        if kind == "private":
            q = q.where(Card.plane == "private")
        elif kind == "mine":
            # D-130: every card of my teams plus anything assigned to me - for an admin, every org
            # card (they belong to no team but oversee all). Who may move each one stays per card
            # (`canMove`, D-117: the assignee, the team's lead or an admin).
            q = q.where(Card.plane == "org")
            if not actor.is_admin:
                q = q.where(or_(Card.assignee_id == actor.id, Card.team_id.in_(my_team_ids(actor))))
        elif kind == "team":
            q = q.where(Card.team_id == team_id)
        elif kind == "no_team":
            # D-122: unassigned cards that also have no team.
            q = q.where(Card.plane == "org", Card.assignee_id.is_(None), Card.team_id.is_(None))
        else:
            # D-122 (narrows CR-17): only cards nobody is assigned to - they must be claimed.
            # A card someone holds is never here, whatever its team.
            q = q.where(Card.plane == "org", Card.assignee_id.is_(None))
        q = self._filtered(q, f).order_by(
            # D-136: my own cards first in every column, then priority, ETA, age.
            case((Card.assignee_id == actor.id, 0), else_=1),
            Card.priority.asc().nulls_last(),
            Card.eta.asc().nulls_last(),
            Card.created_at.asc(),
        )
        return [_row(r) for r in await self.db.execute(q)]

    async def search(
        self, actor: Actor, f: CardFilter, exact_number: int, offset: int, limit: int
    ) -> tuple[int, list[CardRow]]:
        base = self._filtered(self._visible(actor), f)
        total = (
            await self.db.execute(select(func.count()).select_from(base.subquery()))
        ).scalar_one()
        rows = await self.db.execute(
            base.order_by(
                case((Card.number == exact_number, 1), else_=0).desc(), Card.updated_at.desc()
            )
            .offset(offset)
            .limit(limit)
        )
        return int(total), [_row(r) for r in rows]

    # ---- unscoped reads (the services decide what the caller may learn)
    async def by_id(self, card_id: str) -> CardRow | None:
        row = (await self.db.execute(select(*_COLS).where(Card.id == card_id))).first()
        return _row(row) if row else None

    async def with_tag(self, name: str) -> list[CardRow]:
        rows = await self.db.execute(select(*_COLS).where(Card.tags.contains([name])))
        return [_row(r) for r in rows]

    async def any_with_tag(self, name: str) -> bool:
        q = select(exists(select(Card.id).where(Card.tags.contains([name]))))
        return bool((await self.db.execute(q)).scalar_one())

    async def in_project(self, project_id: str, *, open_only: bool = False) -> list[CardRow]:
        q = select(*_COLS).where(Card.project_id == project_id)
        if open_only:
            q = q.where(Card.closed_at.is_(None))
        return [_row(r) for r in await self.db.execute(q)]

    async def any_in_project(self, project_id: str) -> bool:
        q = select(exists(select(Card.id).where(Card.project_id == project_id)))
        return bool((await self.db.execute(q)).scalar_one())

    async def open_held_in_team(self, team_id: str, user_id: str) -> list[CardRow]:
        rows = await self.db.execute(
            select(*_COLS).where(
                Card.team_id == team_id, Card.assignee_id == user_id, Card.closed_at.is_(None)
            )
        )
        return [_row(r) for r in rows]

    # ---- writes
    async def insert(self, values: dict[str, Any]) -> CardRow:
        """The new row; like every write result its `logged_hours` reads 0."""
        row = (await self.db.execute(insert(Card).values(**values).returning(*_COLS))).one()
        return _row(row)

    async def write(self, card: CardRow, values: dict[str, Any], now: datetime) -> CardRow:
        """Set columns on one card, bumping its version. Returns the new row (`logged_hours`
        reads 0 on write results, as it always has - plan §6 item 3)."""
        row = (
            await self.db.execute(
                update(Card)
                .where(Card.id == card.id)
                .values(**values, version=card.version + 1, updated_at=now)
                .returning(*_COLS)
            )
        ).one()
        return _row(row)

    async def insert_comment(
        self, *, comment_id: str, card_id: str, author_id: str, body: str, now: datetime
    ) -> None:
        await self.db.execute(
            insert(CardComment).values(
                id=comment_id,
                card_id=card_id,
                author_id=author_id,
                body=body,
                created_at=now,
                edited_at=None,
                copied_from_card_id=None,
                parent_id=None,
            )
        )
