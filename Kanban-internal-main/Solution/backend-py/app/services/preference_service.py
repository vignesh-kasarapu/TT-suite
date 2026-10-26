"""Server-stored preferences: theme, accent preset, mail opt-in, default team/project (D-077),
Org tab order and inbox retention (CR-19)."""

from dataclasses import asdict, replace

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import FieldError, ValidationFailedException
from app.repositories.inbox_repository import DEFAULT_WINDOW_DAYS
from app.repositories.preference_repository import PreferenceRepository, PreferenceRow
from app.repositories.project_repository import ProjectRepository
from app.repositories.team_repository import TeamRepository
from app.schemas.me_schema import Preferences, PreferencesPatch

# Preset keys of the house theme's design tokens; a new preset is added here and in the frontend.
ACCENTS = ("linen", "harbour", "graphite")

DEFAULTS = PreferenceRow(
    theme="system",
    accent="linen",
    notify_email=False,
    primary_team_id=None,
    primary_project_id=None,
    org_order="team_first",
    inbox_window_days=DEFAULT_WINDOW_DAYS,
)


def _to_schema(p: PreferenceRow) -> Preferences:
    return Preferences.model_validate(asdict(p))


class PreferenceService:
    def __init__(
        self,
        uow: UnitOfWork,
        prefs: PreferenceRepository,
        teams: TeamRepository,
        projects: ProjectRepository,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.prefs = prefs
        self.teams = teams
        self.projects = projects
        self.clock = clock

    async def _current(self, user_id: str) -> PreferenceRow:
        return await self.prefs.get(user_id) or DEFAULTS

    async def get(self, actor: Actor) -> Preferences:
        return _to_schema(await self._current(actor.id))

    async def update(self, actor: Actor, patch: PreferencesPatch) -> Preferences:
        changes = patch.model_dump(exclude_unset=True, by_alias=False)
        accent = changes.get("accent")
        if accent is not None and accent not in ACCENTS:
            raise ValidationFailedException(
                "Unknown accent preset.",
                [FieldError("ENUM", f"accent must be one of {', '.join(ACCENTS)}", "accent")],
            )
        # D-077: the default team must be one of mine; the default project must sit in one of
        # my teams.
        my_teams = await self.teams.team_ids_of(actor.id)
        team_id = changes.get("primary_team_id")
        if team_id and team_id not in my_teams:
            raise ValidationFailedException(
                "Pick one of your own teams.",
                [FieldError("NOT_A_MEMBER", "Not one of your teams.", "primaryTeamId")],
            )
        project_id = changes.get("primary_project_id")
        if project_id:
            project_team = await self.projects.team_id_of(project_id)
            if project_team is None or project_team not in my_teams:
                raise ValidationFailedException(
                    "Pick a project of one of your teams.",
                    [
                        FieldError(
                            "NOT_A_MEMBER", "Not a project of your teams.", "primaryProjectId"
                        )
                    ],
                )
        merged = replace(await self._current(actor.id), **changes)
        await self.prefs.upsert(actor.id, merged, self.clock.now())
        await self.uow.commit()
        return _to_schema(merged)
