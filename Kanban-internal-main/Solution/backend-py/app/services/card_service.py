"""Cards: boards, search, create, read, update, move, plane copy and history.

Every write: load the card in the caller's scope, check write access and version, apply, and
write its events - one transaction (FR-041). Board order is decided here (priority, then ETA
with no-ETA last, then created); closed cards stay on a board for 14 days (D-028).
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import AppException, FieldError, ValidationFailedException
from app.repositories.card_repository import BoardKind, CardFilter, CardRepository, CardRow
from app.repositories.comment_repository import CommentRepository
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.project_repository import ProjectRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository
from app.schemas.card_schema import (
    Board,
    Card,
    CardCopyRequest,
    CardCreateRequest,
    CardEventPage,
    CardPatchRequest,
    CardSearchPage,
)
from app.services.access_service import AccessService, release_to_backlog
from app.services.card_access_service import CardAccessService, other_team
from app.services.card_mapper import (
    CLOSED_STATES,
    card_wire,
    key_of,
    num,
    number_of,
    summary_wire,
    user_wire,
)
from app.services.link_service import LinkService
from app.services.notify_service import NotifyContext, NotifyService
from app.services.placement_service import UNSET, Placement, PlacementService
from app.utils.time import iso_utc
from app.utils.ulid import ulid

CLOSED_VISIBLE_DAYS = 14
STATES = (
    "backlog",
    "in_prep",
    "ready",
    "in_development",
    "uat",
    "delivered",
    "cancelled",
)

# PATCH key -> (event field, column). Order is the order events are written.
PATCHABLE = {
    "title": ("title", "title"),
    "description": ("description", "description"),
    "assignee_id": ("assignee", "assignee_id"),
    "priority": ("priority", "priority"),
    "tags": ("tags", "tags"),
    "eta": ("eta", "eta"),
    "effort_hours": ("effort", "effort_hours"),
}


@dataclass(frozen=True)
class BoardQuery:
    include_closed: bool = False
    tag: str | None = None
    priority: int | None = None
    q: str | None = None
    project_id: str | None = None
    program_id: str | None = None
    assignee_id: str | None = None


@dataclass(frozen=True)
class SearchQuery:
    text: str = ""
    include_closed: bool = True
    plane: str | None = None
    team_id: str | None = None
    project_id: str | None = None
    program_id: str | None = None
    assignee_id: str | None = None
    state: str | None = None
    tag: str | None = None
    priority: int | None = None


def _wire_value(key: str, row: CardRow) -> Any:
    """The current value of a patchable field, in the form events record."""
    return {
        "title": row.title,
        "description": row.description,
        "assignee_id": row.assignee_id,
        "priority": row.priority,
        "tags": list(row.tags),
        "eta": row.eta.isoformat() if row.eta else None,
        "effort_hours": num(row.effort_hours),
    }[key]


def _requested(key: str, value: Any) -> Any:
    """A requested value in event form (dates as YYYY-MM-DD, numbers as JSON shows them)."""
    if key == "eta" and value is not None:
        return value.isoformat()
    if key == "effort_hours":
        return num(value)
    return value


class CardService:
    def __init__(
        self,
        uow: UnitOfWork,
        cards: CardRepository,
        comments: CommentRepository,
        events: EventRepository,
        teams: TeamRepository,
        projects: ProjectRepository,
        users: UserRepository,
        access: CardAccessService,
        people: AccessService,
        placement: PlacementService,
        links: LinkService,
        notify: NotifyService,
        clock: Clock,
        org_tz: str,
    ) -> None:
        self.org_tz = org_tz
        self.uow = uow
        self.cards = cards
        self.comments = comments
        self.events = events
        self.teams = teams
        self.projects = projects
        self.users = users
        self.access = access
        self.people = people
        self.placement = placement
        self.links = links
        self.notify = notify
        self.clock = clock

    # ---- boards and search
    async def board(
        self, actor: Actor, kind: BoardKind, query: BoardQuery, team_id: str | None = None
    ) -> Board:
        if kind == "team":
            assert team_id is not None
            team = await self.teams.get(team_id)
            if team is None:
                raise AppException(404, "NOT_FOUND", "No such team.")
            # CR-14: members and admins only; CR-28: say whose board it is.
            if not await self.access.can_place_in(actor, team_id):
                raise other_team(team.name, "board")
        cutoff = self.clock.now() - timedelta(days=CLOSED_VISIBLE_DAYS)
        f = CardFilter(
            include_closed=True,
            closed_since=None if query.include_closed else cutoff,
            text=query.q,
            tag=query.tag,
            priority=query.priority,
            project_id=query.project_id,
            program_id=query.program_id,
            assignee_id=query.assignee_id,
        )
        columns: dict[str, list[dict[str, Any]]] = {s: [] for s in STATES}
        leads = await self.access.lead_team_ids(actor)
        today = self._today()
        for row in await self.cards.board(actor, kind, f, team_id):
            columns[row.state].append(self._view(actor, row, leads, today))
        return Board.model_validate({"columns": columns})

    async def search(
        self, actor: Actor, query: SearchQuery, offset: int, limit: int
    ) -> CardSearchPage:
        """Closed cards are searchable unless `includeClosed=false` (FR-054); an exact key
        match comes first, then the most recently updated."""
        text = query.text.strip()
        exact = number_of(text.upper()) or -1
        f = CardFilter(
            include_closed=query.include_closed,
            text=text or None,
            plane=query.plane,
            team_id=query.team_id,
            project_id=query.project_id,
            program_id=query.program_id,
            assignee_id=query.assignee_id,
            state=query.state,
            tag=query.tag,
            priority=query.priority,
        )
        total, rows = await self.cards.search(actor, f, exact, offset, limit)
        return CardSearchPage.model_validate(
            {
                "total": total,
                "offset": offset,
                "limit": limit,
                "items": [summary_wire(r) for r in rows],
            }
        )

    # ---- single card
    async def get(self, actor: Actor, key: str) -> Card:
        return await self._card(actor, await self.access.load(actor, key))

    async def _insert(
        self, actor: Actor, values: dict[str, Any], created_extra: dict[str, Any] | None = None
    ) -> CardRow:
        """Insert a card whose placement and assignee were checked; writes its `created` event."""
        now = self.clock.now()
        row = await self.cards.insert(
            {
                **values,
                "id": ulid(now),
                "owner_id": actor.id,
                "closed_at": now if values["state"] in CLOSED_STATES else None,
                "created_at": now,
                "updated_at": now,
            }
        )
        await self.events.write_card_events(
            row.id,
            actor.id,
            now,
            [EventInput("created", None, {**card_wire(row), **(created_extra or {})})],
        )
        return row

    async def create(self, actor: Actor, body: CardCreateRequest) -> Card:
        now = self.clock.now()
        sent = body.model_fields_set
        plane = body.plane or "private"
        placement = await self.placement.for_new_card(
            actor,
            plane,
            body.team_id if "team_id" in sent else UNSET,
            body.project_id if "project_id" in sent else UNSET,
        )
        # CR-17, D-147: a new card is assigned to its creator unless someone else is named;
        # a card nobody holds only comes from releasing one later (it then drops to Backlog).
        assignee_id = body.assignee_id or actor.id
        await self.people.assert_assignee(plane, actor.id, placement.team_id, assignee_id)
        row = await self._insert(
            actor,
            {
                "title": body.title,
                "description": body.description or "",
                "plane": plane,
                "state": body.state or "backlog",
                "assignee_id": assignee_id,
                "team_id": placement.team_id,
                "project_id": placement.project_id,
                "priority": body.priority,  # D-134: none unless chosen
                "tags": await self.placement.canonical_tags(body.tags or []),
                "eta": body.eta,
                "effort_hours": body.effort_hours,
            },
        )
        if assignee_id and assignee_id != actor.id:
            await self._assigned(actor, row, assignee_id)
        if body.depends_on_key:
            n = number_of(body.depends_on_key)
            target = None if n is None else await self.cards.visible_by_number(actor, n)
            if target is None:
                raise ValidationFailedException(
                    "No such predecessor card.",
                    [FieldError("NOT_FOUND", "No such card.", "dependsOnKey")],
                )
            await self.links.create_link(actor, row, target, "depends_on", now)
            row = await self.access.load(actor, key_of(row.number))
        await self.uow.commit()
        return await self._card(actor, row)

    def _today(self) -> date:
        return date.fromisoformat(self.clock.today(self.org_tz))

    def _view(self, actor: Actor, row: CardRow, leads: set[str], today: date) -> dict[str, Any]:
        """A card as the caller sees it: `canMove` for them (D-117) and `overdue` (D-152: open
        with an ETA before today in ORG_TZ - the rule the reports count by)."""
        return {
            **card_wire(row),
            "canMove": self.access.movable(actor, row, leads),
            "overdue": row.closed_at is None and row.eta is not None and row.eta < today,
        }

    async def _card(self, actor: Actor, row: CardRow) -> Card:
        leads = await self.access.lead_team_ids(actor)
        return Card.model_validate(self._view(actor, row, leads, self._today()))

    async def _assigned(self, actor: Actor, row: CardRow, assignee_id: str) -> None:
        await self.notify.enqueue(
            "assigned",
            NotifyContext(
                card_key=key_of(row.number),
                card_title=row.title,
                actor_name=actor.name,
                detail="assigned to you",
                team_id=row.team_id,
                user_id=assignee_id,
            ),
            self.clock.now(),
        )

    async def update(self, actor: Actor, key: str, patch: CardPatchRequest) -> Card:
        now = self.clock.now()
        sent = patch.model_fields_set
        row = await self.access.load_writable(actor, key)
        self.access.assert_version(row, patch.version)
        values: dict[str, Any] = {}
        events: list[EventInput] = []
        placement = await self.placement.resolve(
            actor,
            row.plane,
            Placement(row.team_id, row.project_id),
            patch.team_id if "team_id" in sent else UNSET,
            patch.project_id if "project_id" in sent else UNSET,
        )
        if placement.team_id != row.team_id:
            values["team_id"] = placement.team_id
            events.append(
                EventInput(
                    "team",
                    await self.teams.name_ref(row.team_id),
                    await self.teams.name_ref(placement.team_id),
                )
            )
        if placement.project_id != row.project_id:
            values["project_id"] = placement.project_id
            events.append(
                EventInput(
                    "project",
                    await self.projects.name_ref(row.project_id),
                    await self.projects.name_ref(placement.project_id),
                )
            )
        for field_key, (event_field, column) in PATCHABLE.items():
            if field_key not in sent:
                continue
            requested = getattr(patch, field_key)
            if field_key == "tags":
                requested = await self.placement.canonical_tags(requested)
            current = _wire_value(field_key, row)
            if current == _requested(field_key, requested):
                continue
            if field_key == "assignee_id":
                # Read by people, so it carries {id, name} like team/project events do.
                old, new = await self.users.name_ref(current), await self.users.name_ref(requested)
            else:
                old, new = current, _requested(field_key, requested)
            events.append(EventInput(event_field, old, new))
            values[column] = requested
        assignee_id: str | None = values.get("assignee_id", row.assignee_id)
        # D-095: a team move the holder cannot follow drops the card rather than refusing it.
        if "assignee_id" not in values and placement.team_id != row.team_id:
            kept = await self.placement.assignee_after_move(placement.team_id, assignee_id)
            if kept != assignee_id:
                events.append(EventInput("assignee", await self.users.name_ref(assignee_id), None))
                assignee_id = kept
                values["assignee_id"] = kept
        if "assignee_id" in values or placement.team_id != row.team_id:
            await self.people.assert_assignee(
                row.plane, row.owner_id, placement.team_id, assignee_id
            )
        if "assignee_id" in values:
            drop = release_to_backlog(row, assignee_id)
            if drop:
                values["state"] = "backlog"
                events.append(drop)
        if not events:
            return await self._card(actor, row)
        saved = await self.cards.write(row, values, now)
        await self.events.write_card_events(row.id, actor.id, now, events)
        if (
            "assignee_id" in values
            and assignee_id
            and assignee_id != actor.id
            and assignee_id != row.assignee_id
        ):
            await self._assigned(actor, saved, assignee_id)
        await self.uow.commit()
        return await self._card(actor, saved)

    async def move(self, actor: Actor, key: str, state: str, version: int) -> Card:
        now = self.clock.now()
        row = await self.access.load_writable(actor, key)
        await self.access.assert_movable(actor, row)  # D-117
        self.access.assert_version(row, version)
        if row.state == state:
            return await self._card(actor, row)
        closing = state in CLOSED_STATES
        saved = await self.cards.write(
            row, {"state": state, "closed_at": (row.closed_at or now) if closing else None}, now
        )
        await self.events.write_card_events(
            row.id, actor.id, now, [EventInput("state", row.state, state)]
        )
        if closing and row.state not in CLOSED_STATES:
            await self.notify.enqueue(
                "closed",
                NotifyContext(
                    key_of(saved.number), saved.title, actor.name, state, saved.team_id, None
                ),
                now,
            )
        await self.uow.commit()
        return await self._card(actor, saved)

    async def copy(self, actor: Actor, key: str, body: CardCopyRequest) -> Card:
        """D-056: a linked copy on the other plane, with the chosen comments and events."""
        now = self.clock.now()
        sent = body.model_fields_set
        source = await self.access.load(actor, key)
        self.access.assert_version(source, body.version)
        if body.target_plane == source.plane:
            raise AppException(
                422,
                "SAME_PLANE",
                "The card is already on that plane.",
                [FieldError("SAME_PLANE", "Choose the other plane.", "targetPlane")],
            )
        to_org = body.target_plane == "org"
        placement = await self.placement.for_new_card(
            actor,
            body.target_plane,
            body.team_id if "team_id" in sent else UNSET,
            body.project_id if "project_id" in sent else UNSET,
        )
        assignee_id = body.assignee_id if "assignee_id" in sent else source.assignee_id
        # The copy is the actor's; on a private copy only they can hold it. D-147: an org copy
        # nobody is named for is the copier's, as a new card is.
        effective = (
            (assignee_id or actor.id) if to_org else (actor.id if assignee_id == actor.id else None)
        )
        await self.people.assert_assignee(body.target_plane, actor.id, placement.team_id, effective)
        copy = await self._insert(
            actor,
            {
                "title": body.title if body.title is not None else source.title,
                "description": (
                    body.description if body.description is not None else source.description
                ),
                "plane": body.target_plane,
                "state": body.state or source.state,
                "assignee_id": effective,
                "team_id": placement.team_id,
                "project_id": placement.project_id,
                "priority": body.priority if "priority" in sent else source.priority,
                "tags": (
                    list(source.tags)
                    if "tags" not in sent
                    else await self.placement.canonical_tags(body.tags or [])
                ),
                "eta": body.eta if "eta" in sent else source.eta,
                "effort_hours": (
                    body.effort_hours if "effort_hours" in sent else source.effort_hours
                ),
            },
            {"copiedFromKey": key_of(source.number)},
        )
        if body.comment_ids:
            found = await self.comments.copy(source.id, copy.id, body.comment_ids, now)
            if found != len(set(body.comment_ids)):
                raise ValidationFailedException(
                    "Unknown comment on the source card.",
                    [FieldError("NOT_FOUND", "Unknown comment id.", "commentIds")],
                )
        if body.event_ids:
            found = await self.events.copy_card_events(source.id, copy.id, body.event_ids, now)
            if found != len(set(body.event_ids)):
                raise ValidationFailedException(
                    "Unknown event on the source card.",
                    [FieldError("NOT_FOUND", "Unknown event id.", "eventIds")],
                )
        await self.links.create_link(actor, copy, source, "relates_to", now)
        src = await self.access.load(actor, key)  # its version moved with the link
        await self.events.write_card_events(
            src.id,
            actor.id,
            now,
            [
                EventInput(
                    "copied_to", None, {"key": key_of(copy.number), "plane": body.target_plane}
                )
            ],
        )
        # CR-24: a closed source can be copied but not cancelled as well.
        if body.cancel_source and to_org:
            self.access.assert_card_open(src)
        if body.cancel_source and to_org and src.state != "cancelled":
            await self.cards.write(
                src, {"state": "cancelled", "closed_at": src.closed_at or now}, now
            )
            await self.events.write_card_events(
                src.id, actor.id, now, [EventInput("state", src.state, "cancelled")]
            )
        else:
            await self.cards.write(src, {}, now)
        result = await self.access.load(actor, key_of(copy.number))
        await self.uow.commit()
        return await self._card(actor, result)

    # ---- history
    async def events_page(
        self, actor: Actor, key: str, field: str | None, offset: int, limit: int
    ) -> CardEventPage:
        row = await self.access.load(actor, key)
        sees_all = actor.is_admin or (
            row.team_id is not None and await self.teams.is_lead(actor.id, row.team_id)
        )
        total, items = await self.events.card_event_page(
            row.id,
            field=field,
            only_own_time_events_of=None if sees_all else actor.id,
            offset=offset,
            limit=limit,
        )
        # CR-28: the other card an event points at, and whose team it is when unreadable.
        refs = [
            _ref_number(e.old_value) or _ref_number(e.new_value) or e.copied_from_number
            for e in items
        ]
        limited = await self.cards.unreadable_org_teams(
            actor, sorted({n for n in refs if n is not None})
        )
        return CardEventPage.model_validate(
            {
                "total": total,
                "offset": offset,
                "limit": limit,
                "items": [
                    {
                        "id": e.id,
                        "groupId": e.group_id,
                        "field": e.field,
                        "oldValue": e.old_value,
                        "newValue": e.new_value,
                        "actor": user_wire(e.actor_id, e.actor_name, e.actor_email, e.actor_role),
                        "createdAt": iso_utc(e.created_at),
                        "copiedFromKey": (
                            key_of(e.copied_from_number) if e.copied_from_number else None
                        ),
                        "limitedTeam": limited.get(ref) if ref is not None else None,
                    }
                    for e, ref in zip(items, refs, strict=True)
                ],
            }
        )


def _ref_number(value: Any) -> int | None:
    """The card an event value points at: `otherKey` (links), `key` (copied_to),
    `copiedFromKey` (created)."""
    if not isinstance(value, dict):
        return None
    key = value.get("otherKey") or value.get("key") or value.get("copiedFromKey")
    return number_of(key) if isinstance(key, str) else None
