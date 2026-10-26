"""Who is calling (ADR-005; TT Suite SUITE-CONTRACT §3.1) and the contact-admin form (D-125).

Since the TT Suite, sign-in and sessions are the portal's: the request carries the suite
session cookie, `suite_core.identity` resolves it to a person and their Kanban role, and the
person is mapped to their `app_user` (by `suite_user_id`, then email; self-healed or activated
by `SuiteService.ensure_local`). Kanban's own `session` table is no longer written; the OIDC
flow and Kanban's sign-out are gone from the web path (the portal owns both).

The actor's role still comes from `app_user.role`, so every existing check is unchanged.
The dev/test fixed-identity sign-in (never in prod) now issues a suite session for the person.
"""

from dataclasses import dataclass

from app.core.clock import Clock
from app.core.config import Settings
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import NotFoundException
from app.repositories.login_issue_repository import LoginIssueRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.suite_repository import SuiteRepository
from app.repositories.user_repository import UserRefRow, UserRepository
from app.schemas.auth_schema import AuthConfig, ContactAdminRequest, UserRef, UserRefList
from app.services.suite_service import SuiteService


@dataclass(frozen=True)
class ActorLookup:
    actor: Actor | None
    expired: bool  # a cookie was sent but names no live suite session: clear it
    # Signed in to the suite, but no Kanban access or an inactive Kanban account (403).
    no_access: bool = False


class AuthService:
    def __init__(
        self,
        uow: UnitOfWork,
        users: UserRepository,
        suite: SuiteRepository,
        links: SuiteService,
        settings: Settings,
        clock: Clock,
        notifications: NotificationRepository,
        login_issues: LoginIssueRepository,
    ) -> None:
        self.uow = uow
        self.login_issues = login_issues
        self.users = users
        self.suite = suite
        self.links = links
        self.notifications = notifications
        self.settings = settings
        self.clock = clock

    def auth_config(self) -> AuthConfig:
        return AuthConfig(provider="suite")

    async def resolve_actor(self, cookie_value: str | None) -> ActorLookup:
        """Suite cookie -> Actor (SUITE-CONTRACT §3.1). No live suite session -> no actor (401
        where a session is needed); no Kanban role or an inactive Kanban account -> no actor and
        `no_access` (403 NO_APP_ACCESS where a session is needed)."""
        if not cookie_value:
            return ActorLookup(None, expired=False)
        ident = await self.suite.resolve(cookie_value)
        if ident is None:
            return ActorLookup(None, expired=True)
        if ident.app_role is None:
            return ActorLookup(None, expired=False, no_access=True)
        user = await self.links.ensure_local(
            suite_user_id=ident.user_id,
            email=ident.email,
            name=ident.name,
            entra_oid=ident.entra_oid,
            suite_role=ident.app_role,
        )
        if user is None or user.status != "active":
            return ActorLookup(None, expired=False, no_access=True)
        actor = Actor(
            user.id,
            user.name,
            user.email,
            "admin" if user.role == "admin" else "member",
            ident.session_id,
            ident.session_expires_at,
            ident.user_id,
        )
        return ActorLookup(actor, expired=False)

    async def dev_sign_in(self, user_id: str) -> str:
        """Dev/test fixed-identity provider (never in prod): the user id is the whole proof.
        Makes sure the suite person exists and is active, mirrors their Kanban role from the
        local one, and opens a suite session. Returns the raw cookie value."""
        found = await self.users.find_status_by_id(user_id)
        if found is None or found[2] == "inactive":
            raise NotFoundException("No such active user.")
        suite_id = await self.links.mirror(user_id, actor=None)
        if suite_id is None:
            raise NotFoundException("No such active user.")
        await self.suite.activate_person(suite_id)
        token = await self.suite.insert_session(suite_id, self.settings.SESSION_HOURS)
        await self.uow.commit()
        return token

    async def contact_admin(self, body: ContactAdminRequest) -> None:
        """D-125: someone who cannot sign in writes to the admins; each active admin gets it by
        email through the outbox, and it is kept for Administration > Login issues (D-144). The
        answer is the same whoever asks, so it reveals nothing."""
        now = self.clock.now()
        payload = {
            "name": body.name.strip(),
            "email": body.email,
            "message": body.message.strip(),
            "url": f"{self.settings.PUBLIC_BASE_URL}/admin/users",
        }
        await self.login_issues.add(
            name=payload["name"], email=body.email, message=payload["message"], now=now
        )
        for user in await self.users.list_all(active_only=True):
            if user.role == "admin":
                await self.notifications.enqueue(
                    channel="email",
                    target_id=user.id,
                    kind="contact_admin",
                    payload=payload,
                    now=now,
                )
        await self.uow.commit()

    async def list_dev_users(self) -> UserRefList:
        rows = await self.users.list_admittable()
        return UserRefList(items=[_short_ref(r) for r in rows])


def _short_ref(r: UserRefRow) -> UserRef:
    """id, name, email, role only (the dev pick-list never carried the photo stamp)."""
    return UserRef.model_validate({"id": r.id, "name": r.name, "email": r.email, "role": r.role})
