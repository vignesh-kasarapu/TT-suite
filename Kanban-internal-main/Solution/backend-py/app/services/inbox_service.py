"""The inbox (D-066, CR-15/16/19): what other people changed on my cards and in my teams,
newest first, filtered, grouped by message type, with unread flags. Marking read only stamps
events the person can actually see; clearing removes entries up to a moment (the card history
itself stays whole, FR-041)."""

from datetime import datetime

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.repositories.inbox_repository import GROUPS, REASONS, InboxFilter, InboxRepository
from app.schemas.report_schema import InboxPage
from app.services.card_mapper import key_of, user_wire
from app.utils.time import iso_utc

# The controller passes the request filters as this; the repository stays behind the service.
InboxQuery = InboxFilter


class InboxService:
    def __init__(self, uow: UnitOfWork, inbox: InboxRepository, clock: Clock) -> None:
        self.uow = uow
        self.inbox = inbox
        self.clock = clock

    async def page(self, actor: Actor, f: InboxFilter, offset: int, limit: int) -> InboxPage:
        now = self.clock.now()
        st = await self.inbox.settings(actor)
        total = await self.inbox.total(actor, now, st, f)
        # Group totals cover the whole filtered set, never one group's page (CR-16).
        by_group = await self.inbox.group_totals(
            actor, now, st, InboxFilter(f.team_id, f.project_id, f.assigned_to_me, None)
        )
        rows = await self.inbox.page(actor, now, st, f, offset, limit)
        return InboxPage.model_validate(
            {
                "total": total,
                "offset": offset,
                "limit": limit,
                "unread": await self.inbox.unread_count(actor, now),
                "groups": [{"group": g, "total": by_group.get(g, 0)} for g in GROUPS],
                "items": [
                    {
                        "event": {
                            "id": r.event_id,
                            "groupId": r.group_id,
                            "field": r.field,
                            "oldValue": r.old_value,
                            "newValue": r.new_value,
                            "actor": user_wire(
                                r.actor_id, r.actor_name, r.actor_email, r.actor_role
                            ),
                            "createdAt": iso_utc(r.created_at),
                            "copiedFromKey": None,
                        },
                        "card": {
                            "id": r.card_id,
                            "key": key_of(r.number),
                            "title": r.title,
                            "plane": r.plane,
                            "state": r.state,
                            "priority": r.priority,
                            "teamId": r.team_id,
                            "projectId": r.project_id,
                            "assigneeId": r.assignee_id,
                            "eta": r.eta,
                            "closedAt": r.closed_at,
                        },
                        "reason": REASONS.get(r.rank, "team"),
                        "group": r.group,
                        "unread": r.unread,
                    }
                    for r in rows
                ],
            }
        )

    async def mark_seen(self, actor: Actor) -> None:
        await self.inbox.mark_seen(actor.id, self.clock.now())
        await self.uow.commit()

    async def mark_read(self, actor: Actor, event_ids: list[str]) -> None:
        """Ids the person cannot see are skipped, not refused: the caller reports what it
        rendered."""
        now = self.clock.now()
        st = await self.inbox.settings(actor)
        visible = await self.inbox.visible_ids(actor, now, st, event_ids)
        await self.inbox.mark_read(actor.id, visible, now)
        await self.uow.commit()

    async def clear(self, actor: Actor, before: datetime) -> None:
        await self.inbox.clear_before(actor.id, before)
        await self.uow.commit()
