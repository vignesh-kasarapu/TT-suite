"""Sessions and cookies (ADR-005, D-050, D-077, NFR-015; TT Suite SUITE-CONTRACT §3.1).

- Since the TT Suite, the session is the portal's: the cookie is `__Host-tt_session` (prod) or
  `tt_session` (dev/test), the row lives in `app.session`, and Kanban only reads it. The
  scheme is unchanged: 32 random bytes (base64url) in the cookie, only their SHA-256 hex stored.
- prod: `HttpOnly; Secure; SameSite=Lax; Path=/` (no Domain); dev/test without Secure (WebKit
  rejects Secure cookies over http://localhost).
- No Expires/Max-Age on the session cookie: the server's `expires_at` is the authority.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from suite_core import cookies as suite_cookies
from suite_core.constants import session_cookie_name as suite_session_cookie_name

from app.core.config import Profile

Role = Literal["anonymous", "member", "admin", "dev"]
EPOCH: str = suite_cookies.EPOCH


@dataclass(frozen=True)
class Actor:
    """Who is calling, rebuilt from the database on every request, never from the session row
    alone, so a role or status change applies at once."""

    id: str
    name: str
    email: str
    role: Literal["member", "admin"]
    session_id: str  # the stored hash (`app.session.id`), not the cookie value
    session_expires_at: datetime
    # The person's `app.users.id`: the acting admin named in `app.app_access` mirrors.
    suite_user_id: str | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def hash_session_id(cookie_value: str) -> str:
    return str(suite_cookies.hash_session_id(cookie_value))


def new_session_token() -> str:
    return str(suite_cookies.new_session_token())


def roles_of(actor: Actor) -> list[Role]:
    """Every signed-in user is a member; admins are both."""
    return ["member", "admin"] if actor.is_admin else ["member"]


def can(actor: Actor | None, x_roles: list[Role], profile: Profile) -> str:
    """Structural authorisation from the operation's x-roles (ADR-007): 'allow' |
    'unauthenticated' | 'forbidden'. Object-level rules live in the services."""
    if "dev" in x_roles and profile != "prod":
        return "allow"
    if "anonymous" in x_roles:
        return "allow"
    if actor is None:
        return "unauthenticated"
    held = roles_of(actor)
    return "allow" if any(r in held for r in x_roles) else "forbidden"


# ---- cookies: the suite session cookie (suite_core.cookies), shared with the portal
def session_cookie_name(profile: Profile) -> str:
    return str(suite_session_cookie_name(profile))


def session_cookie(profile: Profile, token: str) -> str:
    return str(suite_cookies.session_cookie(profile, token))


def clear_session_cookie(profile: Profile) -> str:
    return str(suite_cookies.clear_session_cookie(profile))
