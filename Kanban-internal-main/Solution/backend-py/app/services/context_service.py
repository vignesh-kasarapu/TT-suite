"""getMe: rebuilt per request from the database, so role and membership changes apply at once."""

from app.core.clock import Clock
from app.core.security import Actor
from app.repositories.inbox_repository import InboxRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository
from app.schemas.auth_schema import user_ref
from app.schemas.me_schema import Me, TeamRef


class ContextService:
    def __init__(
        self,
        users: UserRepository,
        teams: TeamRepository,
        inbox: InboxRepository,
        clock: Clock,
    ) -> None:
        self.users = users
        self.teams = teams
        self.inbox = inbox
        self.clock = clock

    async def me(self, actor: Actor) -> Me:
        memberships = await self.teams.memberships_of(actor.id)
        photo_at = await self.users.photo_updated_at(actor.id)
        return Me(
            user=user_ref(actor.id, actor.name, actor.email, actor.role, photo_at),
            session_expires_at=actor.session_expires_at,
            teams=[TeamRef(id=m.team_id, name=m.name) for m in memberships],
            lead_team_ids=[m.team_id for m in memberships if m.is_lead],
            inbox_unread=await self.inbox.unread_count(actor, self.clock.now()),
        )
