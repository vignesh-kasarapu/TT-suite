"""Card links (FR-030..033, D-048) and dependency trees (FR-033, D-055).

relates_to is symmetric and stored once in canonical order; depends_on: from depends on to;
blocks: from blocks to. Adding or removing a link writes an event on both cards (one group) and
bumps both versions. A tree holds the cards in scope plus directly linked outside cards, the
depends_on edges among them, and every cycle (strongly connected component > 1).
"""

from datetime import datetime
from typing import Any

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    AppException,
    FieldError,
    NotFoundException,
    ValidationFailedException,
)
from app.repositories.card_repository import CardRepository, CardRow
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.link_repository import LinkRepository, LinkRow
from app.repositories.project_repository import ProjectRepository
from app.schemas.card_schema import CardLink, CardLinkList, DependencyTree
from app.services.card_access_service import CardAccessService
from app.services.card_mapper import key_of, number_of, summary_wire
from app.services.notify_service import NotifyContext, NotifyService
from app.utils.time import iso_utc
from app.utils.ulid import ulid


def _event_value(link: LinkRow, other: CardRow, direction: str) -> dict[str, str]:
    return {
        "linkId": link.id,
        "type": link.type,
        "otherKey": key_of(other.number),
        "direction": direction,
    }


def cycles(node_ids: list[str], edges: list[tuple[str, str, str]]) -> list[list[str]]:
    """Tarjan's strongly connected components; only components with more than one node."""
    out: dict[str, list[str]] = {n: [] for n in node_ids}
    for _, src, dst in edges:
        out.setdefault(src, []).append(dst)
    index = 0
    idx: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: set[str] = set()
    stack: list[str] = []
    result: list[list[str]] = []

    def visit(v: str) -> None:
        nonlocal index
        idx[v] = low[v] = index
        index += 1
        stack.append(v)
        on_stack.add(v)
        for w in out.get(v, []):
            if w not in idx:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on_stack:
                low[v] = min(low[v], idx[w])
        if low[v] == idx[v]:
            comp: list[str] = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                comp.append(w)
                if w == v:
                    break
            if len(comp) > 1:
                result.append(sorted(comp))

    for n in node_ids:
        if n not in idx:
            visit(n)
    return result


class LinkService:
    def __init__(
        self,
        uow: UnitOfWork,
        links: LinkRepository,
        cards: CardRepository,
        events: EventRepository,
        projects: ProjectRepository,
        access: CardAccessService,
        notify: NotifyService,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.links = links
        self.cards = cards
        self.events = events
        self.projects = projects
        self.access = access
        self.notify = notify
        self.clock = clock

    async def create_link(
        self, actor: Actor, source: CardRow, target: CardRow, link_type: str, now: datetime
    ) -> LinkRow:
        """The link and its events on both cards, in the caller's transaction."""
        from_card, to_card = (
            (target, source)
            if link_type == "relates_to" and target.id < source.id
            else (source, target)
        )
        if await self.links.exists(from_card.id, to_card.id, link_type):
            raise AppException(
                422,
                "DUPLICATE_LINK",
                "That link already exists.",
                [FieldError("DUPLICATE_LINK", "That link already exists.", "targetKey")],
            )
        link = await self.links.insert(
            link_id=ulid(now),
            from_id=from_card.id,
            to_id=to_card.id,
            link_type=link_type,
            by=actor.id,
            now=now,
        )
        await self._record(actor, "link_added", link, from_card, to_card, now)
        return link

    async def _record(
        self, actor: Actor, field: str, link: LinkRow, frm: CardRow, to: CardRow, now: datetime
    ) -> None:
        added = field == "link_added"
        out_val = _event_value(link, to, "out")
        in_val = _event_value(link, frm, "out" if link.type == "relates_to" else "in")
        group = ulid(now)
        await self.events.write_card_events(
            frm.id,
            actor.id,
            now,
            [EventInput(field, None if added else out_val, out_val if added else None)],
            group,
        )
        await self.events.write_card_events(
            to.id,
            actor.id,
            now,
            [EventInput(field, None if added else in_val, in_val if added else None)],
            group,
        )
        await self.cards.write(frm, {}, now)
        await self.cards.write(to, {}, now)

    async def _items(self, actor: Actor, card: CardRow) -> list[dict[str, Any]]:
        """Links of a card with the other end resolved, only ends the viewer may read."""
        links = await self.links.of_card(card.id)
        if not links:
            return []
        other_ids = [
            lk.to_card_id if lk.from_card_id == card.id else lk.from_card_id for lk in links
        ]
        others = await self.cards.visible_by_ids(actor, other_ids)
        out = []
        for lk in links:
            is_from = lk.from_card_id == card.id
            other = others.get(lk.to_card_id if is_from else lk.from_card_id)
            if other is None:
                continue
            active = None
            if lk.type == "blocks":
                active = (card.closed_at if is_from else other.closed_at) is None
            out.append(
                {
                    "id": lk.id,
                    "type": lk.type,
                    "direction": "out" if lk.type == "relates_to" or is_from else "in",
                    "card": summary_wire(other),
                    "active": active,
                    "createdAt": iso_utc(lk.created_at),
                }
            )
        return out

    async def list_for(self, actor: Actor, key: str) -> CardLinkList:
        card = await self.access.load(actor, key)
        return CardLinkList.model_validate({"items": await self._items(actor, card)})

    async def add(self, actor: Actor, key: str, link_type: str, target_key: str) -> CardLink:
        now = self.clock.now()
        source = await self.access.load_writable(actor, key)
        n = number_of(target_key)
        target = None if n is None else await self.cards.visible_by_number(actor, n)
        if target is None:
            raise ValidationFailedException(
                "No such card.", [FieldError("NOT_FOUND", "No such card.", "targetKey")]
            )
        if target.id == source.id:
            raise ValidationFailedException(
                "A card cannot link to itself.",
                [FieldError("SELF_LINK", "A card cannot link to itself.", "targetKey")],
            )
        link = await self.create_link(actor, source, target, link_type, now)
        if link_type == "blocks":
            await self.notify.enqueue(
                "blocked",
                NotifyContext(
                    card_key=key_of(target.number),
                    card_title=target.title,
                    actor_name=actor.name,
                    detail=f"blocked by {key_of(source.number)}",
                    team_id=target.team_id,
                    user_id=(
                        target.assignee_id
                        if target.assignee_id and target.assignee_id != actor.id
                        else None
                    ),
                ),
                now,
            )
        fresh = await self.access.load(actor, key)
        item = next(i for i in await self._items(actor, fresh) if i["id"] == link.id)
        await self.uow.commit()
        return CardLink.model_validate(item)

    async def remove(self, actor: Actor, key: str, link_id: str) -> None:
        now = self.clock.now()
        card = await self.access.load_writable(actor, key)
        link = await self.links.on_card(card.id, link_id)
        if link is None:
            raise NotFoundException("No such link.")
        # The other end may be a card the actor cannot see: the link still goes, and that card
        # still gets its event - so it is read unscoped.
        other_id = link.to_card_id if link.from_card_id == card.id else link.from_card_id
        other = await self.cards.by_id(other_id)
        assert other is not None
        frm, to = (card, other) if link.from_card_id == card.id else (other, card)
        await self.links.delete(link.id)
        await self._record(actor, "link_removed", link, frm, to, now)
        await self.uow.commit()

    # ---- dependency trees
    async def _tree(self, actor: Actor, in_scope: list[CardRow]) -> DependencyTree:
        scope_ids = {c.id for c in in_scope}
        nodes = {c.id: c for c in in_scope}
        edges: list[tuple[str, str, str]] = []
        if scope_ids:
            links = await self.links.depends_on_touching(sorted(scope_ids))
            external = {
                end
                for lk in links
                for end in (lk.from_card_id, lk.to_card_id)
                if end not in scope_ids
            }
            nodes.update(await self.cards.visible_by_ids(actor, sorted(external)))
            edges = [
                (lk.id, lk.from_card_id, lk.to_card_id)
                for lk in links
                if lk.from_card_id in nodes and lk.to_card_id in nodes
            ]
        ordered = sorted(nodes.values(), key=lambda c: c.number)
        return DependencyTree.model_validate(
            {
                "nodes": [{**summary_wire(c), "external": c.id not in scope_ids} for c in ordered],
                "edges": [{"linkId": i, "fromId": f, "toId": t} for i, f, t in edges],
                "cycles": cycles([c.id for c in ordered], edges),
            }
        )

    async def project_tree(self, actor: Actor, project_id: str) -> DependencyTree:
        if await self.projects.project(project_id) is None:
            raise NotFoundException("No such project.")
        return await self._tree(actor, await self.cards.visible_in_projects(actor, [project_id]))

    async def program_tree(self, actor: Actor, program_id: str) -> DependencyTree:
        if await self.projects.program(program_id) is None:
            raise NotFoundException("No such program.")
        project_ids = [p.id for p in await self.projects.projects(program_id=program_id)]
        return await self._tree(actor, await self.cards.visible_in_projects(actor, project_ids))
