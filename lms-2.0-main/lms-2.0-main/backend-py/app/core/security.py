"""Session JWT issue/verify. Mirrors backend/src/services/auth.service.js's
issueSessionToken exactly: a session expires at MIDNIGHT in the configured
IANA timezone (not a fixed duration, not server-host local time), DST-aware.
Python's zoneinfo (stdlib) makes this simpler than the Node original's manual
Intl.DateTimeFormat offset math, while producing the identical behavior."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from joserfc import jwt
from joserfc.jwk import OctKey

from app.core.config import settings

ALGORITHM = "HS256"


class JWTError(Exception):
    """A session token that is malformed, wrongly signed or expired (joserfc, as the rest of the
    suite; python-jose and its unpatched dependencies were dropped)."""


def _key() -> OctKey:
    return OctKey.import_key(settings.session_jwt_secret)


def seconds_until_midnight(tz_name: str) -> int:
    tz = ZoneInfo(tz_name)
    now = datetime.now(tz)
    next_midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(int((next_midnight - now).total_seconds()), 1)


def issue_session_token(employee_id: int) -> tuple[str, int]:
    """Returns (token, expires_in_seconds) — LMS-002."""
    expires_in = seconds_until_midnight(settings.default_timezone)
    payload = {
        "employee_id": employee_id,
        "exp": int((datetime.now(timezone.utc) + timedelta(seconds=expires_in)).timestamp()),
    }
    token = jwt.encode({"alg": ALGORITHM}, payload, _key(), algorithms=[ALGORITHM])
    return token, expires_in


def decode_session_token(token: str) -> int:
    """Returns the employee_id, or raises JWTError if invalid/expired."""
    try:
        decoded = jwt.decode(token, _key(), algorithms=[ALGORITHM])
        jwt.JWTClaimsRegistry(exp={"essential": True}).validate(decoded.claims)
        return int(decoded.claims["employee_id"])
    except Exception as exc:  # every failure means "not a valid session"
        raise JWTError(str(exc) or type(exc).__name__) from exc


__all__ = ["issue_session_token", "decode_session_token", "seconds_until_midnight", "JWTError"]
