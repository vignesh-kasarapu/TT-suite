"""SQL for the inbox (D-066, CR-15/16/19): card events by other people on cards I hold, own,
commented on, or that belong to my teams, inside my retention window.

`_conditions()` is the one place every inbox filter lives, so the item page, the total, the group
counts and the read stamps all inherit them and cannot drift apart.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import (
    ColumnElement,
    Select,
    Text,
    and_,
    case,
    delete,
    exists,
    func,
    literal_column,
    or_,
    select,
    true,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import Actor
from app.models import AppUser, Card, CardComment, CardEvent, InboxRead, UserPreference
from app.repositories.visibility import TIME_FIELDS, my_team_ids, org_readable, sees_all_hours

DEFAULT_WINDOW_DAYS = 30
NO_TEAM = "none"  # the Team filter's stand-in for "no team"
GROUPS = (
    "assignments",
    "mentions",
    "status_changes",
    "priority_eta",
    "reassignments",
    "comments",
    "other",
)
REASONS = {1: "assigned", 2: "comment", 3: "mine", 4: "team", 5: "mentioned"}


@dataclass(frozen=True)
class InboxSettings:
    window_days: int
    cleared_before: datetime | None
    seen_at: datetime | None


@dataclass(frozen=True)
class InboxFilter:
    team_id: str | None = None
    project_id: str | None = None
    assigned_to_me: bool = False
    group: str | None = None


@dataclass(frozen=True)
class InboxRow:
    event_id: str
    group_id: str
    field: str
    old_value: Any
    new_value: Any
    created_at: datetime
    actor_id: str
    actor_name: str
    actor_email: str
    actor_role: str
    rank: int
    group: str
    unread: bool
    card_id: str
    number: int
    title: str
    plane: str
    state: str
    priority: int | None
    team_id: str | None
    project_id: str | None
    assignee_id: str | None
    eta: date | None
    closed_at: datetime | None


def _assignee_is(actor_id: str) -> ColumnElement[bool]:
    """An `assignee` event pointing at me. It stores {id, name} since FR-074; older rows held the
    bare id as a JSON string."""
    target = func.coalesce(
        CardEvent.new_value["id"].astext,
        CardEvent.new_value.op("#>>", return_type=Text)(literal_column("'{}'")),
    )
    return and_(CardEvent.field == "assignee", target == actor_id)


def _mentioned(actor_id: str) -> ColumnElement[bool]:
    """D-158: a comment naming me as `@[Name](user:<my id>)` - added, or edited to add it (a
    mention already in the old text is not news). Ids are ULIDs, so no LIKE escaping is needed."""
    token = f"(user:{actor_id})"
    added = and_(
        CardEvent.field == "comment_added", CardEvent.new_value["body"].astext.contains(token)
    )
    edited = and_(
        CardEvent.field == "comment_edited",
        CardEvent.new_value["body"].astext.contains(token),
        ~CardEvent.old_value["body"].astext.contains(token),
    )
    return or_(added, edited)


def _group_of(actor_id: str) -> ColumnElement[str]:
    """CR-16 message type; `other` is the catch-all, so nothing is dropped."""
    return case(
        (_assignee_is(actor_id), "assignments"),
        (_mentioned(actor_id), "mentions"),
        (CardEvent.field == "assignee", "reassignments"),
        (CardEvent.field == "state", "status_changes"),
        (CardEvent.field.in_(("priority", "eta", "effort")), "priority_eta"),
        (
            CardEvent.field.in_(("comment_added", "comment_edited", "comment_deleted")),
            "comments",
        ),
        else_="other",
    )


def _reason_rank(actor_id: str) -> ColumnElement[int]:
    """1 assigned to me, 2 comment on a card I hold/own, 3 other change on my card, 4 team."""
    mine = or_(Card.assignee_id == actor_id, Card.owner_id == actor_id)
    return case(
        (_assignee_is(actor_id), 1),
        (_mentioned(actor_id), 5),
        (and_(CardEvent.field == "comment_added", mine), 2),
        (mine, 3),
        else_=4,
    )


class InboxRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def settings(self, actor: Actor) -> InboxSettings:
        """The three per-person knobs the query needs, in one round trip."""
        row = (
            await self.db.execute(
                select(
                    AppUser.inbox_seen_at,
                    AppUser.inbox_cleared_before,
                    UserPreference.inbox_window_days,
                )
                .outerjoin(UserPreference, UserPreference.user_id == AppUser.id)
                .where(AppUser.id == actor.id)
            )
        ).first()
        return InboxSettings(
            window_days=(row.inbox_window_days if row and row.inbox_window_days else None)
            or DEFAULT_WINDOW_DAYS,
            cleared_before=row.inbox_cleared_before if row else None,
            seen_at=row.inbox_seen_at if row else None,
        )

    def _conditions(
        self, actor: Actor, now: datetime, st: InboxSettings, f: InboxFilter
    ) -> list[ColumnElement[bool]]:
        e, c = CardEvent, Card
        conds: list[ColumnElement[bool]] = [
            e.actor_id != actor.id,
            e.created_at > now - timedelta(days=st.window_days),
            # CR-14: the card must still be readable.
            or_(and_(c.plane == "org", org_readable(actor, c.team_id)), c.owner_id == actor.id),
            or_(
                c.assignee_id == actor.id,
                c.owner_id == actor.id,
                exists(
                    select(CardComment.id).where(
                        CardComment.card_id == c.id, CardComment.author_id == actor.id
                    )
                ),
                c.team_id.in_(my_team_ids(actor)),
                # D-158: a mention brings a card I may read into my inbox.
                _mentioned(actor.id),
            ),
            # CR-13: another person's time event carries their hours.
            or_(e.field.not_in(TIME_FIELDS), sees_all_hours(actor, c.team_id)),
        ]
        if st.cleared_before is not None:
            conds.append(e.created_at > st.cleared_before)
        if f.team_id == NO_TEAM:
            conds.append(c.team_id.is_(None))
        elif f.team_id:
            conds.append(c.team_id == f.team_id)
        if f.project_id:
            conds.append(c.project_id == f.project_id)
        if f.assigned_to_me:
            conds.append(c.assignee_id == actor.id)
        if f.group:
            conds.append(_group_of(actor.id) == f.group)
        return conds

    def _from(self, *cols: Any) -> Select[Any]:
        return select(*cols).select_from(CardEvent).join(Card, Card.id == CardEvent.card_id)

    @staticmethod
    def _unread(actor: Actor, seen_at: datetime | None) -> ColumnElement[bool]:
        """Unread = newer than "mark all seen" AND not opened individually (CR-19)."""
        newer = true() if seen_at is None else CardEvent.created_at > seen_at
        opened = exists(
            select(1).where(InboxRead.user_id == actor.id, InboxRead.event_id == CardEvent.id)
        )
        return and_(newer, ~opened)

    async def unread_count(self, actor: Actor, now: datetime) -> int:
        st = await self.settings(actor)
        q = self._from(func.count()).where(
            *self._conditions(actor, now, st, InboxFilter()), self._unread(actor, st.seen_at)
        )
        return int((await self.db.execute(q)).scalar_one())

    async def total(self, actor: Actor, now: datetime, st: InboxSettings, f: InboxFilter) -> int:
        q = self._from(func.count()).where(*self._conditions(actor, now, st, f))
        return int((await self.db.execute(q)).scalar_one())

    async def group_totals(
        self, actor: Actor, now: datetime, st: InboxSettings, f: InboxFilter
    ) -> dict[str, int]:
        """Totals per CR-16 group over the whole filtered set (never just the page)."""
        g = _group_of(actor.id).label("g")
        q = self._from(g, func.count()).where(*self._conditions(actor, now, st, f)).group_by(g)
        return {str(r[0]): int(r[1]) for r in await self.db.execute(q)}

    async def page(
        self,
        actor: Actor,
        now: datetime,
        st: InboxSettings,
        f: InboxFilter,
        offset: int,
        limit: int,
    ) -> list[InboxRow]:
        """Strictly newest first (CR-15); ties by id for stable paging."""
        q = (
            self._from(
                CardEvent.id,
                CardEvent.group_id,
                CardEvent.field,
                CardEvent.old_value,
                CardEvent.new_value,
                CardEvent.created_at,
                AppUser.id,
                AppUser.name,
                AppUser.email,
                AppUser.role,
                _reason_rank(actor.id),
                _group_of(actor.id),
                self._unread(actor, st.seen_at),
                Card.id,
                Card.number,
                Card.title,
                Card.plane,
                Card.state,
                Card.priority,
                Card.team_id,
                Card.project_id,
                Card.assignee_id,
                Card.eta,
                Card.closed_at,
            )
            .join(AppUser, AppUser.id == CardEvent.actor_id)
            .where(*self._conditions(actor, now, st, f))
            .order_by(CardEvent.created_at.desc(), CardEvent.id.desc())
            .offset(offset)
            .limit(limit)
        )
        return [InboxRow(*tuple(r)) for r in await self.db.execute(q)]

    async def visible_ids(
        self, actor: Actor, now: datetime, st: InboxSettings, ids: list[str]
    ) -> list[str]:
        q = self._from(CardEvent.id).where(
            *self._conditions(actor, now, st, InboxFilter()), CardEvent.id.in_(ids)
        )
        return [r[0] for r in await self.db.execute(q)]

    async def mark_read(self, user_id: str, event_ids: list[str], now: datetime) -> None:
        if not event_ids:
            return
        stmt = insert(InboxRead).values(
            [{"user_id": user_id, "event_id": i, "read_at": now} for i in event_ids]
        )
        await self.db.execute(stmt.on_conflict_do_nothing(index_elements=["user_id", "event_id"]))

    async def mark_seen(self, user_id: str, now: datetime) -> None:
        await self.db.execute(
            update(AppUser).where(AppUser.id == user_id).values(inbox_seen_at=now)
        )

    async def clear_before(self, user_id: str, before: datetime) -> None:
        """Everything up to `before` leaves the inbox; read stamps for it are dropped."""
        await self.db.execute(
            update(AppUser).where(AppUser.id == user_id).values(inbox_cleared_before=before)
        )
        await self.db.execute(
            delete(InboxRead).where(
                InboxRead.user_id == user_id,
                InboxRead.event_id.in_(select(CardEvent.id).where(CardEvent.created_at <= before)),
            )
        )
