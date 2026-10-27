"""SQL against the TT Suite's `suite` schema (SUITE-CONTRACT §2, §3).

Every call goes through `suite_core.identity` on the request's own session, so a Kanban change
and its mirror in `app.app_access` commit or roll back together. Kanban never writes
`app.users` itself except through the dev/test sign-in (never mounted in prod).
"""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from suite_core import identity, inbox
from suite_core.cookies import hash_session_id, new_session_token
from suite_core.identity import SuiteIdentity

APP = "kanban"

_OID_ELSEWHERE = text("SELECT 1 FROM app.users WHERE entra_oid = :oid AND email <> :email")
_SUITE_EMAIL = text("SELECT email FROM app.users WHERE id = :id")
_ACTIVATE = text("UPDATE app.users SET status = 'active', updated_at = now() WHERE id = :id")
# The dev session's lifetime follows the database clock, as `identity.resolve` does: Kanban's
# FakeClock (dev/test) never decides whether a suite session is live.
_INSERT_SESSION = text(
    """
    INSERT INTO app.session (id, user_id, created_at, expires_at)
    VALUES (:id, :uid, now(), now() + make_interval(hours => :hours))
    """
)


class SuiteRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def resolve(self, cookie_value: str | None) -> SuiteIdentity | None:
        """Cookie -> active person with a live suite session and their Kanban role, else None."""
        found: SuiteIdentity | None = await identity.aresolve(self.db, cookie_value, APP)
        return found

    async def access_of(self, suite_user_id: str) -> str | None:
        role = await identity.aaccess_of(self.db, suite_user_id, APP)
        return None if role is None else str(role)

    async def mirror(
        self,
        *,
        email: str,
        name: str,
        role: str | None,
        source: str,
        actor: str | None,
        entra_oid: str | None,
        suite_user_id: str | None = None,
    ) -> str:
        """Record the person's Kanban role (None = no access); returns their suite user id.
        `app.users.entra_oid` is unique: an object id another suite person already holds (an
        address changed in Entra, say) is not passed on, so the mirror never fails on it.

        `identity.amirror_access` finds the suite person by email. For a person already linked
        (`suite_user_id`), the suite's current email is used, not Kanban's copy: after the global
        admin changes a work email, a stale local email would otherwise create a second suite
        person."""
        if suite_user_id:
            current = (
                await self.db.execute(_SUITE_EMAIL, {"id": suite_user_id})
            ).scalar_one_or_none()
            if current:
                email = str(current)
        if entra_oid:
            taken = await self.db.execute(
                _OID_ELSEWHERE, {"oid": entra_oid, "email": email.strip().lower()}
            )
            if taken.first() is not None:
                entra_oid = None
        return str(
            await identity.amirror_access(
                self.db,
                email=email,
                name=name,
                app=APP,
                role=role,
                source=source,
                actor=actor,
                entra_oid=entra_oid,
            )
        )

    # ---- role-change requests (only the global admin assigns roles)
    async def request_role_change(
        self,
        *,
        email: str,
        role: str | None,
        requested_by: str | None,
        note: str,
        lead_team_ids: Sequence[str],
    ) -> int:
        """Record the request and message every global admin (the caller commits). Raises
        `suite_core.identity.SuiteAccessError` for an unknown role or a person not in the suite."""
        return int(
            await inbox.arequest_role_change(
                self.db,
                app=APP,
                email=email,
                role=role,
                requested_by=requested_by,
                note=note,
                lead_team_ids=lead_team_ids,
            )
        )

    async def pending_role_requests(self) -> list[dict[str, Any]]:
        found: list[dict[str, Any]] = await inbox.apending_requests(self.db, APP)
        return found

    # ---- dev/test only (the dev sign-in; never mounted in prod)
    async def activate_person(self, suite_user_id: str) -> None:
        await self.db.execute(_ACTIVATE, {"id": suite_user_id})

    async def insert_session(self, suite_user_id: str, hours: int) -> str:
        """A suite session for the person; returns the raw cookie value (never stored)."""
        token = str(new_session_token())
        await self.db.execute(
            _INSERT_SESSION, {"id": hash_session_id(token), "uid": suite_user_id, "hours": hours}
        )
        return token
