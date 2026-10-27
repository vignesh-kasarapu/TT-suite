"""The portal -> app internal contract (localhost only, shared secret).

Every app mounts two routes, outside its public auth and CSRF checks:

    POST /internal/provision   ProvisionRequest  -> ProvisionResult (4xx {"code","detail"} on refusal)
    POST /internal/authorize   AuthorizeRequest  -> AuthorizeResult

`provision` upserts the app's local user through the app's own service layer (so its rules hold)
and, in the same transaction, calls `identity.mirror_access(source="global")`.
`role=None` revokes: the local user is deactivated and the access row deleted.

`authorize` is called when a dashboard card is clicked: confirm the local user exists and is
active, self-heal (provision) it from `app.app_access` when it is missing, and answer the
effective role.
"""

import hmac
from typing import Literal

from pydantic import BaseModel, Field


class ProvisionRequest(BaseModel):
    email: str
    name: str = ""
    entra_oid: str | None = None
    role: str | None = None
    # Kanban only: the teams a `lead` leads (ignored by the other apps).
    kanban_lead_team_ids: list[str] = Field(default_factory=list)
    source: Literal["global", "app"] = "global"
    actor_id: str | None = None  # suite user id of the admin who made the change
    # The suite person (app.users.id): an app finds its user by this first, so a changed work email
    # updates that user instead of creating a second one.
    suite_user_id: str | None = None
    employee_code: str | None = None  # LMS stores it as its employee code; the others ignore it


class ProvisionResult(BaseModel):
    ok: bool = True
    local_user_id: str
    role: str | None


class AuthorizeRequest(BaseModel):
    suite_user_id: str
    email: str
    name: str = ""
    entra_oid: str | None = None


class AuthorizeResult(BaseModel):
    allowed: bool
    role: str | None = None
    code: str | None = None  # e.g. NO_APP_ACCESS, LOCAL_USER_INACTIVE


class InternalError(BaseModel):
    code: str
    detail: str


def internal_token_ok(presented: str | None, expected: str) -> bool:
    """Constant-time compare; an empty configured token refuses everything."""
    return bool(expected) and bool(presented) and hmac.compare_digest(presented or "", expected)
