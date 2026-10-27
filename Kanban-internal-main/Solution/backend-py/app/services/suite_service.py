"""TT Suite single sign-on (SUITE-CONTRACT §3): the link between a suite person and a Kanban
`app_user`, the portal's internal calls, and the mirror of Kanban's own admin changes.

- Effective suite role (§3.3): `admin` if `app_user.role = 'admin'`; else `lead` if the person
  leads any team; else `member`. Inactive -> None (no access).
- `ensure_local()` is the self-heal the sign-in path and `/internal/authorize` share: find the
  person by `suite_user_id`, then by email; create them from the suite role when missing;
  activate an invited row (pinning the Entra object id, as the first SSO sign-in did, D-083).
- `mirror()` runs in the caller's transaction, before the caller's commit (D-109 unit of work).
- Kanban rules still hold for the portal's changes: memberships and leads are written with
  their org events, and an unknown team is refused.
"""

from dataclasses import dataclass

from suite_core.constants import is_valid_role
from suite_core.provision import (
    AuthorizeRequest,
    AuthorizeResult,
    ProvisionRequest,
    ProvisionResult,
)

from app.core.clock import Clock
from app.core.config import Settings
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import ProvisionRefusedException
from app.repositories.event_repository import EventInput, EventRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.preference_repository import PreferenceRepository
from app.repositories.suite_repository import SuiteRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import SuiteLinkRow, UserRepository
from app.utils.ulid import ulid

NO_APP_ACCESS = "NO_APP_ACCESS"
LOCAL_USER_INACTIVE = "LOCAL_USER_INACTIVE"


def local_role(suite_role: str) -> str:
    """Suite role -> `app_user.role`: only admin is a stored role; a lead is a member who leads."""
    return "admin" if suite_role == "admin" else "member"


@dataclass(frozen=True)
class TeamRef:
    id: str
    name: str


class SuiteService:
    def __init__(
        self,
        uow: UnitOfWork,
        suite: SuiteRepository,
        users: UserRepository,
        teams: TeamRepository,
        prefs: PreferenceRepository,
        events: EventRepository,
        notifications: NotificationRepository,
        settings: Settings,
        clock: Clock,
    ) -> None:
        self.uow = uow
        self.suite = suite
        self.users = users
        self.teams = teams
        self.prefs = prefs
        self.events = events
        self.notifications = notifications
        self.settings = settings
        self.clock = clock

    # ---- roles and the mirror (§3.3)
    async def effective_role(self, user_id: str) -> str | None:
        user = await self.users.link_of(user_id)
        if user is None or user.status == "inactive":
            return None
        if user.role == "admin":
            return "admin"
        return "lead" if await self.teams.leads_any(user.id) else "member"

    async def actor_suite_id(self, actor: Actor | None) -> str | None:
        """The acting admin's suite user id, when known."""
        if actor is None:
            return None
        return actor.suite_user_id or await self.users.suite_user_id_of(actor.id)

    async def mirror(self, user_id: str, *, actor: Actor | None, source: str = "app") -> str | None:
        """Write the person's effective role to `app.app_access` (no commit: the caller's
        transaction carries it). Returns their suite user id."""
        user = await self.users.link_of(user_id)
        if user is None:
            return None
        return await self._mirror(
            user, await self.effective_role(user.id), source, await self.actor_suite_id(actor)
        )

    async def _mirror(
        self, user: SuiteLinkRow, role: str | None, source: str, actor_suite_id: str | None
    ) -> str:
        suite_id = await self.suite.mirror(
            email=user.email,
            name=user.name,
            role=role,
            source=source,
            actor=actor_suite_id,
            entra_oid=user.external_id,
        )
        if user.suite_user_id != suite_id:
            await self.users.set_suite_user_id(user.id, suite_id)
        return suite_id

    async def backfill(self) -> int:
        """Boot: mirror every active or invited person not yet linked to the suite, so the people
        Kanban already had keep their access when sign-in moves to the portal. Idempotent (a
        mirrored person is linked and skipped next time); one transaction."""
        ids = await self.users.unlinked_ids()
        for user_id in ids:
            await self.mirror(user_id, actor=None)
        if ids:
            await self.uow.commit()
        return len(ids)

    # ---- self-heal (§3.1 step 3, §3.2 authorize)
    async def ensure_local(
        self,
        *,
        suite_user_id: str,
        email: str,
        name: str,
        entra_oid: str | None,
        suite_role: str,
    ) -> SuiteLinkRow | None:
        """The local person for a suite person who has Kanban access, created or activated as
        needed; None when the local account is inactive. Commits only when it changed something.

        A self-healed `lead` starts as a member: which teams they lead is the portal's to say
        (through /internal/provision); the suite row is left as it is."""
        now = self.clock.now()
        email = email.strip().lower()
        user = await self.users.find_link(suite_user_id=suite_user_id, email=email)
        if user is None:
            oid = (
                entra_oid
                if entra_oid and not await self.users.external_id_taken(entra_oid, None)
                else None
            )
            created = await self.users.insert_linked(
                user_id=ulid(now),
                email=email,
                name=name.strip() or email.split("@")[0],
                role=local_role(suite_role),
                status="active",
                external_id=oid,
                suite_user_id=suite_user_id,
                invited_by=None,
                now=now,
            )
            if created is not None:
                await self.prefs.insert_defaults(
                    created.id, primary_team_id=None, primary_project_id=None, now=now
                )
                await self.uow.commit()
                return created
            # A concurrent first request created them a moment ago: carry on with that row.
            user = await self.users.find_link(suite_user_id=suite_user_id, email=email)
            if user is None:
                return None
        if user.status == "inactive":
            return None
        changed = False
        if user.suite_user_id != suite_user_id:
            await self.users.set_suite_user_id(user.id, suite_user_id)
            changed = True
        # First arrival activates; the Entra object id is pinned to the row (D-083).
        pin = (
            entra_oid
            if entra_oid
            and user.external_id is None
            and not await self.users.external_id_taken(entra_oid, user.id)
            else None
        )
        if user.status == "invited" or pin:
            await self.users.activate(user.id, pin, now)
            changed = True
        # The name is the suite's (edited in the portal's profile): follow it when it changes.
        suite_name = name.strip()
        if suite_name and suite_name != user.name:
            await self.users.set_synced_name(user.id, suite_name, now)
            changed = True
        if changed:
            await self.uow.commit()
            user = await self.users.link_of(user.id)
        return user

    # ---- internal routes (§3.2)
    async def authorize(self, req: AuthorizeRequest) -> AuthorizeResult:
        role = await self.suite.access_of(req.suite_user_id)
        if role is None:
            return AuthorizeResult(allowed=False, code=NO_APP_ACCESS)
        user = await self.ensure_local(
            suite_user_id=req.suite_user_id,
            email=req.email,
            name=req.name,
            entra_oid=req.entra_oid,
            suite_role=role,
        )
        if user is None:
            return AuthorizeResult(allowed=False, code=LOCAL_USER_INACTIVE)
        return AuthorizeResult(allowed=True, role=await self.effective_role(user.id))

    async def list_teams(self) -> list[TeamRef]:
        return [TeamRef(t.id, t.name) for t in await self.teams.list_all()]

    async def provision(self, req: ProvisionRequest) -> ProvisionResult:
        """Upsert the person through Kanban's rules and mirror the result, in one transaction.
        `role=None` deactivates. `lead` leads exactly the given teams (joining them if needed);
        any other role clears every lead flag. A `source="global"` change sends no Kanban
        invitation mail (the portal sends the suite one)."""
        if not is_valid_role("kanban", req.role):
            raise ProvisionRefusedException("INVALID_ROLE", f"Unknown Kanban role {req.role!r}.")
        now = self.clock.now()
        email = req.email.strip().lower()
        if "@" not in email:
            raise ProvisionRefusedException("INVALID_EMAIL", "An email address is needed.")
        admin = await self.users.find_by_suite_id(req.actor_id) if req.actor_id else None
        user = await self.users.find_link(suite_user_id=None, email=email)

        if req.role is None:
            if user is not None and user.status != "inactive":
                await self.users.update(user.id, {"status": "inactive"}, now)
            if user is not None:
                await self._mirror(user, None, req.source, req.actor_id)
            else:
                await self.suite.mirror(
                    email=email,
                    name=req.name,
                    role=None,
                    source=req.source,
                    actor=req.actor_id,
                    entra_oid=req.entra_oid,
                )
            await self.uow.commit()
            return ProvisionResult(local_user_id=user.id if user else "", role=None)

        created = user is None
        oid = (
            req.entra_oid
            if req.entra_oid
            and (user is None or user.external_id is None)
            and not await self.users.external_id_taken(req.entra_oid, user.id if user else None)
            else None
        )
        if user is None:
            fresh = await self.users.insert_linked(
                user_id=ulid(now),
                email=email,
                name=req.name.strip() or email.split("@")[0],
                role=local_role(req.role),
                status="invited",
                external_id=oid,
                suite_user_id=None,
                invited_by=admin.id if admin else None,
                now=now,
            )
            if fresh is None:
                raise ProvisionRefusedException(
                    "CONFLICT", "The person was added at the same moment; try again."
                )
            user = fresh
            leads = req.kanban_lead_team_ids if req.role == "lead" else []
            first_team = leads[0] if leads else None
            if first_team and await self.teams.get(first_team) is None:
                first_team = None
            await self.prefs.insert_defaults(
                user.id, primary_team_id=first_team, primary_project_id=None, now=now
            )
        else:
            values: dict[str, object] = {}
            if user.role != local_role(req.role):
                values["role"] = local_role(req.role)
            if user.status == "inactive":
                values["status"] = "active"  # reactivation, as PATCH /users/{id} allows
            if oid:
                values["external_id"] = oid
            if values:
                await self.users.update(user.id, values, now)

        # Org events need a Kanban actor: the acting admin when they have a Kanban account,
        # else the person themself.
        by = admin.id if admin else user.id
        if req.role == "lead":
            for team_id in dict.fromkeys(req.kanban_lead_team_ids):
                await self._lead(team_id, user, by)
        else:
            for m in await self.teams.memberships_of(user.id):
                if m.is_lead:
                    await self._set_lead(m.team_id, user, False, by)

        role = await self.effective_role(user.id)
        if req.role == "lead" and role != "lead":
            raise ProvisionRefusedException(
                "LEAD_TEAMS_REQUIRED", "A Kanban lead needs at least one team to lead."
            )
        await self._mirror(user, role, req.source, req.actor_id)
        if created and req.source == "app":
            await self.notifications.enqueue(
                channel="email",
                target_id=user.id,
                kind="invited",
                payload={
                    "actorName": admin.name if admin else "An admin",
                    "url": self.settings.PUBLIC_BASE_URL,
                },
                now=now,
            )
        await self.uow.commit()
        return ProvisionResult(local_user_id=user.id, role=role)

    async def _lead(self, team_id: str, user: SuiteLinkRow, by: str) -> None:
        now = self.clock.now()
        if await self.teams.get(team_id) is None:
            raise ProvisionRefusedException("TEAM_NOT_FOUND", f"No such Kanban team {team_id}.")
        if not await self.teams.is_member(user.id, team_id):
            await self.teams.add_member(team_id, user.id, by, now)
            await self.events.write_org_events(
                "team",
                team_id,
                by,
                now,
                [EventInput("member_added", None, {"id": user.id, "name": user.name})],
            )
        if not await self.teams.is_lead(user.id, team_id):
            await self._set_lead(team_id, user, True, by)

    async def _set_lead(self, team_id: str, user: SuiteLinkRow, is_lead: bool, by: str) -> None:
        """Same write and event as TeamService.set_lead."""
        now = self.clock.now()
        await self.teams.set_lead(team_id, user.id, is_lead)
        await self.events.write_org_events(
            "team",
            team_id,
            by,
            now,
            [
                EventInput(
                    "member_lead",
                    not is_lead,
                    {"id": user.id, "name": user.name, "isLead": is_lead},
                )
            ],
        )
