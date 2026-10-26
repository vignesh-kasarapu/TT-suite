"""Session JWT issue/verify. Mirrors backend/src/services/auth.service.js's
issueSessionToken exactly: a session expires at MIDNIGHT in the configured
IANA timezone (not a fixed duration, not server-host local time), DST-aware.
Python's zoneinfo (stdlib) makes this simpler than the Node original's manual
Intl.DateTimeFormat offset math, while producing the identical behavior."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from jose import JWTError, jwt

from app.core.config import settings

ALGORITHM = "HS256"


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
        "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in),
    }
    token = jwt.encode(payload, settings.session_jwt_secret, algorithm=ALGORITHM)
    return token, expires_in


def decode_session_token(token: str) -> int:
    """Returns the employee_id, or raises jose.JWTError if invalid/expired."""
    payload = jwt.decode(token, settings.session_jwt_secret, algorithms=[ALGORITHM])
    return int(payload["employee_id"])


__all__ = ["issue_session_token", "decode_session_token", "seconds_until_midnight", "JWTError"]
