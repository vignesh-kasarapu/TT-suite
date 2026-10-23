"""Suite session tokens and cookies (same scheme as Kanban's ADR-005 sessions).

The cookie carries 32 random bytes (base64url); `suite.session.id` stores only its SHA-256 hex,
so a copy of the table cannot replay a session. No Expires on the cookie: the row's
`expires_at` is the authority.
"""

import base64
import hashlib
import secrets

from suite_core.constants import session_cookie_name

EPOCH = "Thu, 01 Jan 1970 00:00:00 GMT"


def hash_session_id(cookie_value: str) -> str:
    return hashlib.sha256(cookie_value.encode("utf-8")).hexdigest()


def new_session_token() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def _cookie(
    name: str,
    value: str,
    *,
    path: str,
    secure: bool,
    max_age: int | None = None,
    expires: str | None = None,
) -> str:
    parts = [f"{name}={value}"]
    if max_age is not None:
        parts.append(f"Max-Age={max_age}")
    parts.append(f"Path={path}")
    if expires is not None:
        parts.append(f"Expires={expires}")
    parts += ["HttpOnly", "SameSite=Lax"]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def session_cookie(profile: str, token: str) -> str:
    return _cookie(session_cookie_name(profile), token, path="/", secure=profile == "prod")


def clear_session_cookie(profile: str) -> str:
    return _cookie(
        session_cookie_name(profile), "", path="/", secure=profile == "prod", expires=EPOCH
    )


def flight_cookie(profile: str, name: str, value: str, path: str, max_age: int) -> str:
    return _cookie(name, value, path=path, secure=profile == "prod", max_age=max_age)


def clear_flight_cookie(profile: str, name: str, path: str) -> str:
    return _cookie(name, "", path=path, secure=profile == "prod", expires=EPOCH)
