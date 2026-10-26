"""Notification outbox (D-073): rows are queued in the caller's transaction; a worker sends them.

assigned: email to the person, always (D-123); blocked: email when they opted in (FR-045);
both also go to the team's Teams channel when it has a webhook; comment / closed: the team's
Teams channel only.
"""

from dataclasses import dataclass
from datetime import datetime

from app.core.config import Settings
from app.repositories.notification_repository import NotificationRepository
from app.repositories.preference_repository import PreferenceRepository
from app.repositories.team_repository import TeamRepository


@dataclass(frozen=True)
class NotifyContext:
    card_key: str
    card_title: str
    actor_name: str
    detail: str
    team_id: str | None
    user_id: str | None  # email recipient (assigned / blocked); None when nobody personal


class NotifyService:
    def __init__(
        self,
        notifications: NotificationRepository,
        prefs: PreferenceRepository,
        teams: TeamRepository,
        settings: Settings,
    ) -> None:
        self.notifications = notifications
        self.prefs = prefs
        self.teams = teams
        self.settings = settings

    async def enqueue(self, kind: str, ctx: NotifyContext, now: datetime) -> None:
        payload = {
            "cardKey": ctx.card_key,
            "cardTitle": ctx.card_title,
            "actorName": ctx.actor_name,
            "detail": ctx.detail,
            "url": f"{self.settings.PUBLIC_BASE_URL}/cards/{ctx.card_key}",
        }
        targets: list[tuple[str, str]] = []
        if ctx.user_id and (
            kind == "assigned"  # D-123: everyone hears when work is handed to them
            or (kind == "blocked" and await self.prefs.notify_email(ctx.user_id))
        ):
            targets.append(("email", ctx.user_id))
        if ctx.team_id and await self.teams.has_webhook(ctx.team_id):
            targets.append(("teams", ctx.team_id))
        for channel, target in targets:
            await self.notifications.enqueue(
                channel=channel, target_id=target, kind=kind, payload=payload, now=now
            )
