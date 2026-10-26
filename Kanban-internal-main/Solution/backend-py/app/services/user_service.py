"""People: the picker list, admission (invite, re-invite, deactivate, D-083) and admin
grant/revoke (FR-004, D-053). Nobody changes their own account. Directory search for the invite
form goes to Microsoft Graph (D-084).

TT Suite (SUITE-CONTRACT §3.3): every invite, role or status change is mirrored to
`app.app_access` in the same transaction, with the person's effective suite role and the
acting admin's suite id. Deactivation needs no session revocation any more: the next request
finds the person inactive and answers 403 NO_APP_ACCESS."""

from typing import Any

from app.core.clock import Clock
from app.core.config import Settings
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    FieldError,
    GraphErrorException,
    NotConfiguredException,
    NotFoundException,
    ValidationFailedException,
)
from app.integrations.graph import GraphClient
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.preference_repository import PreferenceRepository
from app.repositories.project_repository import ProjectRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository, UserRow
from app.schemas.auth_schema import UserRef
from app.schemas.org_schema import (
    DirectoryHit,
    DirectoryHits,
    InviteUserRequest,
    UpdateUserRequest,
    UserList,
)
from app.services.suite_service import SuiteService
from app.utils.ulid import ulid


def _dto(u: UserRow) -> UserRef:
    return UserRef.model_validate(
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "status": u.status,
            "photoUpdatedAt": u.photo_updated_at,
        }
    )


def _invalid(message: str, field: str, code: str, detail: str) -> ValidationFailedException:
    return ValidationFailedException(message, [FieldError(code, detail, field)])


class UserService:
    def __init__(
        self,
        uow: UnitOfWork,
        users: UserRepository,
        teams: TeamRepository,
        projects: ProjectRepository,
        prefs: PreferenceRepository,
        notifications: NotificationRepository,
        events: EventRepository,
        graph: GraphClient,
        settings: Settings,
        clock: Clock,
        suite: SuiteService,
    ) -> None:
        self.uow = uow
        self.users = users
        self.teams = teams
        self.projects = projects
        self.prefs = prefs
        self.suite = suite
        self.notifications = notifications
        self.events = events
        self.graph = graph
        self.settings = settings
        self.clock = clock

    async def list_all(self, actor: Actor, status: str | None) -> UserList:
        everyone = status == "all" and actor.is_admin
        return UserList(
            items=[_dto(u) for u in await self.users.list_all(active_only=not everyone)]
        )

    async def _enqueue_invitation(self, user_id: str, actor: Actor) -> None:
        """D-083: the invitation email goes out regardless of the person's mail opt-in."""
        await self.notifications.enqueue(
            channel="email",
            target_id=user_id,
            kind="invited",
            payload={"actorName": actor.name, "url": self.settings.PUBLIC_BASE_URL},
            now=self.clock.now(),
        )

    async def invite(self, actor: Actor, body: InviteUserRequest) -> UserRef:
        now = self.clock.now()
        email = body.email.strip().lower()
        if await self.users.email_taken(email):
            raise _invalid(
                "That email is already admitted.", "email", "EMAIL_TAKEN", "Already on the list."
            )
        team_ids = list(dict.fromkeys(body.team_ids))
        teams = {t: await self.teams.name_ref(t) for t in team_ids}
        if any(ref is None for ref in teams.values()):
            raise _invalid("No such team.", "teamIds", "NOT_FOUND", "No such team.")
        if body.project_id:
            project_team = await self.projects.team_id_of(body.project_id)
            if project_team is None or project_team not in team_ids:
                raise _invalid(
                    "The project must belong to one of the teams.",
                    "projectId",
                    "NOT_IN_TEAM",
                    "Not a project of those teams.",
                )
        user = await self.users.insert_invited(
            user_id=ulid(now),
            email=email,
            name=body.name.strip(),
            external_id=body.external_id,
            invited_by=actor.id,
            now=now,
        )
        for team_id in team_ids:
            await self.teams.add_member(team_id, user.id, actor.id, now)
            await self.events.write_org_events(
                "team",
                team_id,
                actor.id,
                now,
                [EventInput("member_added", None, {"id": user.id, "name": user.name})],
            )
        await self.prefs.insert_defaults(
            user.id, primary_team_id=team_ids[0], primary_project_id=body.project_id, now=now
        )
        await self._enqueue_invitation(user.id, actor)
        await self.suite.mirror(user.id, actor=actor)
        await self.uow.commit()
        return _dto(user)

    async def update(self, actor: Actor, user_id: str, patch: UpdateUserRequest) -> UserRef:
        if user_id == actor.id:
            raise _invalid(
                "You cannot change your own account.", "role", "SELF", "Ask another admin."
            )
        now = self.clock.now()
        user = await self.users.get(user_id)
        if user is None:
            raise NotFoundException("No such user.")
        values: dict[str, Any] = {}
        if patch.role is not None and patch.role != user.role:
            values["role"] = patch.role
        if patch.status is not None and patch.status != user.status:
            if user.status == "invited" and patch.status == "active":
                raise _invalid(
                    "Invited people become active by signing in.",
                    "status",
                    "INVITED",
                    "Re-send the invitation instead.",
                )
            values["status"] = patch.status
        if not values:
            return _dto(user)
        user = await self.users.update(user.id, values, now)
        await self.suite.mirror(user.id, actor=actor)
        await self.uow.commit()
        return _dto(user)

    async def resend_invitation(self, actor: Actor, user_id: str) -> None:
        user = await self.users.get(user_id)
        if user is None:
            raise NotFoundException("No such user.")
        if user.status != "invited":
            raise _invalid(
                "Only invited people can be re-invited.",
                "status",
                "NOT_INVITED",
                "Already signed in or inactive.",
            )
        await self._enqueue_invitation(user.id, actor)
        await self.uow.commit()

    async def search_directory(self, q: str) -> DirectoryHits:
        """Up to 10 enabled tenant accounts whose name or mail starts with `q`."""
        if not self.graph.configured:
            raise NotConfiguredException(
                "Directory search needs the Entra settings.", status_code=404
            )
        term = q.replace('"', "").replace("\\", "").strip()
        if len(term) < 2:
            return DirectoryHits(items=[])
        status, value = await self.graph.search_users(term)
        if status >= 400:
            raise GraphErrorException(
                "Directory lookup refused (403): the app registration needs the User.Read.All "
                "application permission with admin consent."
                if status == 403
                else f"Directory lookup failed ({status})."
            )
        return DirectoryHits(
            items=[
                DirectoryHit(
                    external_id=str(u["id"]),
                    name=str(u["displayName"]),
                    email=str(u.get("mail") or u["userPrincipalName"]).lower(),
                )
                for u in value
                if u.get("accountEnabled") is not False
            ]
        )
