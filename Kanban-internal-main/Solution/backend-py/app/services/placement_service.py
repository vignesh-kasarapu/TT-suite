"""Where a card sits: plane, team and project (FR-023, D-095, CR-12, CR-22), and its tags (D-062).

- A private card has no team or project.
- A project sets the team; naming a different team is refused; placing into a team needs
  membership (or admin); a project that stopped intake or closed takes no new cards (CR-12).
- An org card that has a team cannot be made team-less again (CR-22); a new org card with
  neither team nor project named gets the creator's only team, else their primary team.
"""

from dataclasses import dataclass

from app.core.security import Actor
from app.exceptions.custom_exceptions import AppException, FieldError
from app.repositories.preference_repository import PreferenceRepository
from app.repositories.project_repository import ProjectRepository
from app.repositories.tag_repository import TagRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository
from app.services.access_service import invalid
from app.services.card_access_service import CardAccessService

UNSET = object()


@dataclass(frozen=True)
class Placement:
    team_id: str | None
    project_id: str | None


def team_required() -> AppException:
    return invalid("teamId", "TEAM_REQUIRED", "An org card needs a team.")


class PlacementService:
    def __init__(
        self,
        access: CardAccessService,
        teams: TeamRepository,
        projects: ProjectRepository,
        prefs: PreferenceRepository,
        users: UserRepository,
        tags: TagRepository,
    ) -> None:
        self.access = access
        self.teams = teams
        self.projects = projects
        self.prefs = prefs
        self.users = users
        self.tags = tags

    async def resolve(
        self,
        actor: Actor,
        plane: str,
        current: Placement,
        team_id: object = UNSET,
        project_id: object = UNSET,
    ) -> Placement:
        """`UNSET` = not named in the request; `None` = explicitly null."""
        wants = team_id not in (UNSET, None) or project_id not in (UNSET, None)
        if plane == "private":
            if wants:
                raise invalid("teamId", "PRIVATE_PLANE", "A private card has no team or project.")
            return Placement(None, None)
        if isinstance(project_id, str):
            project = await self.projects.placement(project_id)
            if project is None:
                raise invalid("projectId", "NOT_FOUND", "No such project.")
            pid, project_team, accepting, closed_at = project
            # CR-12 intake stop: moving a card *out* of such a project is still allowed.
            if pid != current.project_id and (not accepting or closed_at is not None):
                raise invalid(
                    "projectId", "NOT_ACCEPTING", "That project is not accepting new cards."
                )
            if isinstance(team_id, str) and team_id != project_team:
                raise invalid(
                    "teamId",
                    "TEAM_MISMATCH",
                    "The team must be the project\N{RIGHT SINGLE QUOTATION MARK}s team.",
                )
            if project_team != current.team_id and not await self.access.can_place_in(
                actor, project_team
            ):
                raise invalid(
                    "projectId",
                    "NOT_A_MEMBER",
                    "You are not a member of the project\N{RIGHT SINGLE QUOTATION MARK}s team.",
                )
            return Placement(project_team, pid)
        if team_id is not UNSET:
            if team_id is None:
                if current.team_id is not None:
                    raise team_required()
                return Placement(None, None)
            assert isinstance(team_id, str)
            if team_id != current.team_id and not await self.access.can_place_in(actor, team_id):
                raise invalid("teamId", "NOT_A_MEMBER", "You are not a member of that team.")
            # Team changed away from the project's team -> the project no longer fits.
            kept = current.project_id if team_id == current.team_id else None
            return Placement(team_id, None if project_id is None else kept)
        if project_id is None:
            return Placement(current.team_id, None)
        return current

    async def default_team(self, actor: Actor) -> str | None:
        """CR-22: the creator's only team, else their primary team while they may place there."""
        mine = await self.teams.team_ids_of(actor.id)
        if len(mine) == 1:
            return mine[0]
        primary = await self.prefs.primary_team_id(actor.id)
        if primary is not None and await self.access.can_place_in(actor, primary):
            return primary
        return None

    async def for_new_card(
        self, actor: Actor, plane: str, team_id: object, project_id: object
    ) -> Placement:
        """CR-22: every new org card has a team."""
        named = team_id is not UNSET or project_id not in (UNSET, None)
        if plane == "org" and not named:
            team_id = await self.default_team(actor)
        placement = await self.resolve(actor, plane, Placement(None, None), team_id, project_id)
        if plane == "org" and placement.team_id is None:
            raise team_required()
        return placement

    async def assignee_after_move(self, team_id: str | None, assignee_id: str | None) -> str | None:
        """D-095: whether the holder can follow a team move; an admin may hold any org card."""
        if assignee_id is None or team_id is None:
            return assignee_id
        user = await self.users.get(assignee_id)
        if user is not None and user.role == "admin":
            return assignee_id
        return assignee_id if await self.teams.is_member(assignee_id, team_id) else None

    async def canonical_tags(self, requested: list[str]) -> list[str]:
        """Requested tags -> their stored spelling (case-insensitive), or 422 UNKNOWN_TAG."""
        if not requested:
            return []
        known = await self.tags.canonical_names(requested)
        out: list[str] = []
        for tag in requested:
            name = known.get(tag.lower())
            if name is None:
                raise AppException(
                    422,
                    "UNKNOWN_TAG",
                    f'"{tag}" is not a tag. Ask an admin to add it.',
                    [FieldError("UNKNOWN_TAG", f'Unknown tag "{tag}".', "tags")],
                )
            if name not in out:
                out.append(name)
        return out
