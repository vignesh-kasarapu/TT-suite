"""People: the picker list and role-change requests.

TT Suite: only the global admin (in the portal) creates accounts and assigns roles; the portal
changes Kanban people through `/internal/provision` (SuiteService). A Kanban admin asks for a
change instead: `request_role` records it in `app.role_request` and messages every global admin
(suite_core.inbox), in the request's transaction."""

from suite_core.identity import SuiteAccessError

from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    FieldError,
    NotFoundException,
    ValidationFailedException,
)
from app.repositories.suite_repository import SuiteRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository, UserRow
from app.schemas.auth_schema import UserRef
from app.schemas.org_schema import (
    RoleChangeRequest,
    RoleRequest,
    RoleRequestCreated,
    RoleRequestList,
    UserList,
)
from app.services.suite_service import SuiteService


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
        suite_repo: SuiteRepository,
        suite: SuiteService,
    ) -> None:
        self.uow = uow
        self.users = users
        self.teams = teams
        self.suite_repo = suite_repo
        self.suite = suite

    async def list_all(self, actor: Actor, status: str | None) -> UserList:
        everyone = status == "all" and actor.is_admin
        return UserList(
            items=[_dto(u) for u in await self.users.list_all(active_only=not everyone)]
        )

    async def request_role(
        self, actor: Actor, user_id: str, body: RoleChangeRequest
    ) -> RoleRequestCreated:
        """Ask the global admin to give the person `role` (None = no access); a lead names the
        teams to lead. Nothing changes until the global admin approves it in the portal."""
        user = await self.users.get(user_id)
        if user is None:
            raise NotFoundException("No such user.")
        team_ids = list(dict.fromkeys(body.team_ids)) if body.role == "lead" else []
        if body.role == "lead":
            if not team_ids:
                raise _invalid(
                    "A lead needs at least one team to lead.",
                    "teamIds",
                    "LEAD_TEAMS_REQUIRED",
                    "Pick one or more teams.",
                )
            for team_id in team_ids:
                if await self.teams.get(team_id) is None:
                    raise _invalid("No such team.", "teamIds", "NOT_FOUND", "No such team.")
        try:
            request_id = await self.suite_repo.request_role_change(
                email=user.email,
                role=body.role,
                requested_by=await self.suite.actor_suite_id(actor),
                note=body.note,
                lead_team_ids=team_ids,
            )
        except SuiteAccessError as e:
            raise _invalid(
                "The suite does not know this person or role.", "role", "NOT_IN_SUITE", str(e)
            ) from e
        await self.uow.commit()
        return RoleRequestCreated(id=request_id)

    async def role_requests(self) -> RoleRequestList:
        return RoleRequestList(
            items=[
                RoleRequest.model_validate(r) for r in await self.suite_repo.pending_role_requests()
            ]
        )
