"""Object-level access rules shared by the org and card services.

Visibility itself (who may read a card) is applied in SQL by `repositories/visibility.py`:
- a private card: its owner only - admins included in "nobody else" (NFR-006);
- an org card: admins, members of its team, and anyone while it has no team (CR-14).

The rules below decide writes.
"""

from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    FieldError,
    ForbiddenException,
    ValidationFailedException,
)
from app.repositories.card_repository import CardBrief
from app.repositories.event_repository import EventInput
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository


def invalid(field: str, code: str, message: str) -> ValidationFailedException:
    return ValidationFailedException(message, [FieldError(code, message, field)])


class AccessService:
    def __init__(self, teams: TeamRepository, users: UserRepository) -> None:
        self.teams = teams
        self.users = users

    async def can_manage_team(self, actor: Actor, team_id: str) -> bool:
        """CR-11: an admin, or a lead of this very team."""
        return actor.is_admin or await self.teams.is_lead(actor.id, team_id)

    async def assert_manage_team(self, actor: Actor, team_id: str) -> None:
        if not await self.can_manage_team(actor, team_id):
            raise ForbiddenException("Only an admin or a lead of this team can do that.")

    async def assert_assignee(
        self, plane: str, owner_id: str, team_id: str | None, assignee_id: str | None
    ) -> None:
        """D-049: who may hold a card. Private: the owner. Org: an active person who is a member
        of the card's team, or an admin (CR-17)."""
        if assignee_id is None:
            return
        if plane == "private":
            if assignee_id != owner_id:
                raise invalid(
                    "assigneeId",
                    "OWNER_ONLY",
                    "Only the owner can be the assignee of a private card.",
                )
            return
        user = await self.users.get(assignee_id)
        if user is None or user.status != "active":
            raise invalid("assigneeId", "NOT_FOUND", "No such active user.")
        if (
            team_id is not None
            and user.role != "admin"
            and not await self.teams.is_member(assignee_id, team_id)
        ):
            raise invalid(
                "assigneeId",
                "NOT_A_MEMBER",
                "The assignee must be a member of the card’s team.",  # noqa: RUF001 - the API text uses this apostrophe
            )


def release_to_backlog(card: CardBrief, next_assignee_id: str | None) -> EventInput | None:
    """CR-17: an open org card that loses its assignee drops to Backlog, so unclaimed work
    collects there. Private and closed cards are exempt. Returns the `state` event to write
    (the caller also sets the column), or None when the rule does not apply."""
    if next_assignee_id is not None:
        return None
    if card.plane != "org" or card.closed_at is not None or card.state == "backlog":
        return None
    return EventInput("state", card.state, "backlog")
