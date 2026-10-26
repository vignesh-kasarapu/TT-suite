"""Who may open and change a card.

- Reading is decided in SQL (`repositories/visibility.py`). A card the caller may not read is
  404 when it is private or does not exist - its existence is not leaked - and 403 `OTHER_TEAM`
  naming the team when it is an org card of a team the caller is not in (CR-28).
- Writing: the owner on a private card; on an org card anyone while it has no team, else a
  member of its team or an admin (D-060).
- A closed card is read-only except its comments (CR-24); a closed project's cards are
  read-only, admins included (CR-12).
"""

from app.core.security import Actor
from app.exceptions.custom_exceptions import AppException, ForbiddenException, NotFoundException
from app.repositories.card_repository import CardRepository, CardRow
from app.repositories.project_repository import ProjectRepository
from app.repositories.team_repository import TeamRepository
from app.services.card_mapper import number_of


def other_team(team_name: str, what: str = "card") -> ForbiddenException:
    return ForbiddenException(
        f"Access limited as the {what} belongs to another team - {team_name}.", "OTHER_TEAM"
    )


class CardAccessService:
    def __init__(
        self, cards: CardRepository, teams: TeamRepository, projects: ProjectRepository
    ) -> None:
        self.cards = cards
        self.teams = teams
        self.projects = projects

    async def load(self, actor: Actor, key: str) -> CardRow:
        number = number_of(key)
        if number is None:
            raise NotFoundException("No such card.")
        row = await self.cards.visible_by_number(actor, number)
        if row is not None:
            return row
        hidden_team = await self.cards.hidden_org_team(number)
        if hidden_team is not None:
            raise other_team(hidden_team)
        raise NotFoundException("No such card.")

    async def can_place_in(self, actor: Actor, team_id: str) -> bool:
        """Members, and admins anywhere (D-060)."""
        return actor.is_admin or await self.teams.is_member(actor.id, team_id)

    async def can_write(self, actor: Actor, row: CardRow) -> bool:
        if row.plane == "private":
            return row.owner_id == actor.id
        if row.team_id is None or actor.is_admin:
            return True
        return await self.teams.is_member(actor.id, row.team_id)

    @staticmethod
    def assert_card_open(row: CardRow) -> None:
        if row.closed_at is not None:
            raise AppException(
                403,
                "CARD_CLOSED",
                "This card is closed and read-only; only its comments can change. "
                "Raise a new card instead.",
            )

    async def assert_project_open(self, row: CardRow) -> None:
        if row.project_id is None:
            return
        if await self.projects.closed_at(row.project_id) is not None:
            raise AppException(
                403,
                "PROJECT_CLOSED",
                "That project is closed; its cards are read-only. "
                "Reopen the project to change them.",
            )

    async def assert_open(self, row: CardRow) -> None:
        """Both read-only rules, for writes authorised by authorship (own comment, own time)."""
        self.assert_card_open(row)
        await self.assert_project_open(row)

    async def lead_team_ids(self, actor: Actor) -> set[str]:
        return {m.team_id for m in await self.teams.memberships_of(actor.id) if m.is_lead}

    @staticmethod
    def movable(actor: Actor, row: CardRow, lead_teams: set[str]) -> bool:
        """D-117: the assignee moves a card; a lead of its team and an admin may too. An
        unassigned card is claimed first. A private card is its owner's; a closed one nobody's."""
        if row.closed_at is not None:
            return False
        if row.plane == "private":
            return row.owner_id == actor.id
        if actor.is_admin or (row.team_id is not None and row.team_id in lead_teams):
            return True
        return row.assignee_id == actor.id

    @staticmethod
    def loggable(actor: Actor, row: CardRow, lead_teams: set[str]) -> bool:
        """D-138: time on an org card is logged by its assignee, a lead of its team or an admin
        (as for moving, D-117) - also once it is delivered, so late hours can still be booked."""
        if actor.is_admin or (row.team_id is not None and row.team_id in lead_teams):
            return True
        return row.assignee_id == actor.id

    async def assert_movable(self, actor: Actor, row: CardRow) -> None:
        if not self.movable(actor, row, await self.lead_team_ids(actor)):
            raise ForbiddenException(
                "Only the person working on this card (or a lead of its team) can move it; "
                "claim it first.",
                code="NOT_ASSIGNEE",
            )

    async def assert_writable(self, actor: Actor, row: CardRow) -> None:
        if not await self.can_write(actor, row):
            raise ForbiddenException(
                "Only members of the card\N{RIGHT SINGLE QUOTATION MARK}s team can change it."
            )
        await self.assert_open(row)

    async def load_writable(self, actor: Actor, key: str) -> CardRow:
        row = await self.load(actor, key)
        await self.assert_writable(actor, row)
        return row

    @staticmethod
    def assert_version(row: CardRow, version: int) -> None:
        if row.version != version:
            raise AppException(
                409,
                "STALE_VERSION",
                f"The card changed (now version {row.version}, state {row.state}). "
                "Reload and try again.",
            )
