"""Suite sign-in (Kanban D-083/D-084, now for every app).

- Entra: auth code + PKCE; the in-flight state is sealed into a short-lived cookie (no table).
- Admission: nobody is auto-provisioned. Only a person the global admin (or an app admin)
  invited - status invited or active - may sign in. The first sign-in activates the row and
  pins the Entra object id; name and photo are refreshed from Graph (best effort).
- The session is a `app.session` row keyed by the cookie's SHA-256; every app reads it.
"""

import json
import logging
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.crypto import seal, unseal
from app.core.errors import AppError
from app.repositories.suite_repository import Person, SuiteRepository
from suite_core.cookies import hash_session_id, new_session_token
from suite_core.integrations.entra_oidc import EntraClient, OidcError, pkce_challenge, random_token
from suite_core.integrations.graph import GraphClient

log = logging.getLogger("portal")
FLIGHT_SECONDS = 600


@dataclass(frozen=True)
class Outcome:
    redirect_to: str
    session_token: str | None = None


def safe_return_to(value: str | None) -> str:
    """Same-origin paths only."""
    v = value or ""
    return v if v.startswith("/") and not v.startswith("//") and "\\" not in v else "/"


def identity_from_claims(claims: dict[str, Any]) -> tuple[str, str, str | None]:
    email = str(claims.get("email") or claims.get("preferred_username") or "").strip().lower()
    oid = str(claims.get("oid") or claims.get("sub") or "")
    if "@" not in email or not oid:
        raise AppError(400, "OIDC_CLAIMS", "The Microsoft account has no usable email.")
    name = claims.get("name")
    return email, oid, name if isinstance(name, str) else None


class AuthService:
    def __init__(self, db: AsyncSession, settings: Settings, entra: EntraClient | None, graph: GraphClient) -> None:
        self.db = db
        self.repo = SuiteRepository(db)
        self.settings = settings
        self.entra = entra
        self.graph = graph

    # ---- Entra
    async def oidc_start(self, return_to: str | None) -> tuple[str, str]:
        if self.entra is None:
            raise AppError(404, "NOT_FOUND", "Microsoft sign-in is not active.")
        verifier, state, nonce = random_token(32), random_token(32), random_token(32)
        url = await self.entra.authorize_url(state=state, nonce=nonce, challenge=pkce_challenge(verifier))
        flight = {
            "state": state, "nonce": nonce, "verifier": verifier,
            "returnTo": safe_return_to(return_to), "exp": int(time.time()) + FLIGHT_SECONDS,
        }
        return url, seal(self.settings.APP_SECRET, json.dumps(flight))

    async def oidc_complete(self, params: dict[str, str], sealed: str | None) -> Outcome:
        if self.entra is None:
            raise AppError(404, "NOT_FOUND", "Microsoft sign-in is not active.")
        try:
            if not sealed:
                raise AppError(400, "OIDC_STATE", "Sign-in state is missing; start again.")
            try:
                flight = json.loads(unseal(self.settings.APP_SECRET, sealed))
            except AppError:
                raise
            except Exception as err:
                raise AppError(400, "OIDC_STATE", "Sign-in state is damaged; start again.") from err
            if int(flight.get("exp", 0)) < time.time():
                raise AppError(400, "OIDC_STATE", "Sign-in took too long; start again.")
            try:
                claims = await self.entra.exchange(
                    params, state=str(flight["state"]), nonce=str(flight["nonce"]), verifier=str(flight["verifier"])
                )
            except OidcError as err:
                raise AppError(400, "OIDC_EXCHANGE", f"Microsoft sign-in failed: {err}") from err
            if not claims:
                raise AppError(400, "OIDC_CLAIMS", "No identity token was returned.")
            email, oid, name = identity_from_claims(claims)
            token = await self.establish_session(email=email, oid=oid, name=name)
            if token is None:
                return Outcome(f"/login?error=NOT_ADMITTED&email={quote(email)}")
            return Outcome(str(flight["returnTo"]), token)
        except AppError as err:
            log.warning("oidc_failed code=%s", err.code)
            return Outcome(f"/login?error={quote(err.code)}")
        except Exception:
            log.exception("oidc_failed")
            return Outcome("/login?error=OIDC_FAILED")

    # ---- the one admission path
    async def establish_session(self, *, email: str, oid: str | None, name: str | None) -> str | None:
        person = await self.repo.person_for_sign_in(oid, email)
        if person is None or person.status == "inactive":
            return None
        now = datetime.now(UTC)
        changes: dict[str, Any] = {"last_login_at": now}
        if person.status == "invited":
            changes["status"] = "active"
        if oid and person.entra_oid != oid:
            changes["entra_oid"] = oid
        if name and not person.name:
            changes["name"] = name
        await self.repo.update_person(person.id, **changes)
        token = new_session_token()
        await self.repo.insert_session(hash_session_id(token), person.id, now + timedelta(hours=self.settings.SESSION_HOURS))
        await self.repo.audit(actor_id=person.id, action="sign_in", target_id=person.id)
        await self.repo.purge_expired_sessions()
        await self.db.commit()
        if oid:
            await self._sync_profile(person, oid)
        return token

    async def _sync_profile(self, person: Person, oid: str) -> None:
        """Display name and photo from Graph; a Graph failure never blocks sign-in."""
        if not self.graph.configured:
            return
        try:
            name = await self.graph.display_name(oid)
            photo = await self.graph.photo(oid)
            changes: dict[str, Any] = {}
            if name:
                changes["name"] = name
            if photo:
                changes["photo_type"], changes["photo"] = photo
            if changes:
                await self.repo.update_person(person.id, **changes)
                await self.db.commit()
        except Exception:
            log.warning("graph_profile_sync_failed")
            await self.db.rollback()

    async def dev_sign_in(self, email: str) -> str:
        if self.settings.APP_PROFILE == "prod" or self.settings.AUTH_PROVIDER != "dev":
            raise AppError(404, "NOT_FOUND", "Not found.")
        token = await self.establish_session(email=email.strip().lower(), oid=None, name=None)
        if token is None:
            raise AppError(403, "NOT_ADMITTED", "That person has not been invited (or is deactivated).")
        return token

    async def sign_out(self, cookie_value: str | None) -> None:
        if cookie_value:
            await self.repo.delete_session(hash_session_id(cookie_value))
            await self.db.commit()
