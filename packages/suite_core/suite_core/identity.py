"""Suite identity in the shared database: resolve a cookie to a person + their role in one app,
and mirror an app's own user/role change into `app.app_access`.

Every function takes the caller's open SQLAlchemy connection or session, so it runs inside the
caller's transaction: an app's role change and its mirror commit (or roll back) together.
Sync functions take a `Session`/`Connection`; the `a`-prefixed twins take the async versions.

Rule: only the owning app writes `app.app_access` (see 0001_suite.up.sql).
"""

import json
import logging
import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text

from suite_core.constants import is_valid_role
from suite_core.cookies import hash_session_id
from suite_core.ulid import ulid

log = logging.getLogger("suite_core")

# Sessions slide: each use moves the end to "idle window from now", never past the maximum
# lifetime from sign-in. Every process reads the same environment (deploy/run.py).
SESSION_IDLE_HOURS = int(os.environ.get("SESSION_IDLE_HOURS", "24"))
SESSION_MAX_DAYS = int(os.environ.get("SESSION_MAX_DAYS", "30"))
# A session row is written at most this often, however many requests it serves.
_REFRESH_EVERY = timedelta(minutes=5)


@dataclass(frozen=True)
class SuiteIdentity:
    user_id: str
    email: str
    name: str
    entra_oid: str | None
    is_global_admin: bool
    session_id: str
    session_expires_at: datetime
    app: str | None
    app_role: str | None  # None = no access to `app`

    @property
    def has_access(self) -> bool:
        return self.app_role is not None


class SuiteAccessError(Exception):
    """A mirror call was given an unknown app or role."""


_RESOLVE = text(
    """
    SELECT u.id, u.email, u.name, u.entra_oid, u.is_global_admin, s.id AS sid, s.expires_at,
           a.role, s.created_at
      FROM app.session s
      JOIN app.users u ON u.id = s.user_id
      LEFT JOIN app.app_access a ON a.user_id = u.id AND a.app = :app
     WHERE s.id = :sid AND s.expires_at > now() AND u.status = 'active'
    """
)

_FIND_USER = text("SELECT id, status FROM app.users WHERE email = :email")
_INSERT_USER = text(
    """
    INSERT INTO app.users (id, email, name, entra_oid, status, invited_by, invited_at)
    VALUES (:id, :email, :name, :oid, 'invited', :by, now())
    ON CONFLICT (email) DO NOTHING
    """
)
_FILL_USER = text(
    """
    UPDATE app.users
       SET name = CASE WHEN name = '' AND :name <> '' THEN :name ELSE name END,
           entra_oid = COALESCE(entra_oid, :oid),
           updated_at = now()
     WHERE id = :id
    """
)
_UPSERT_ACCESS = text(
    """
    INSERT INTO app.app_access (user_id, app, role, source, updated_by, updated_at)
    VALUES (:uid, :app, :role, :source, :by, now())
    ON CONFLICT (user_id, app) DO UPDATE
       SET role = EXCLUDED.role, source = EXCLUDED.source,
           updated_by = EXCLUDED.updated_by, updated_at = now()
    """
)
_DELETE_ACCESS = text("DELETE FROM app.app_access WHERE user_id = :uid AND app = :app")
_AUDIT = text(
    """
    INSERT INTO app.audit_log (actor_id, action, target_id, app, detail)
    VALUES (:actor, :action, :target, :app, CAST(:detail AS jsonb))
    """
)
_ACCESS_OF = text("SELECT role FROM app.app_access WHERE user_id = :uid AND app = :app")
_REVOKE_SESSIONS = text("DELETE FROM app.session WHERE user_id = :uid")
_PREFS = text("SELECT preset, mode FROM app.user_preference WHERE user_id = :uid")
_EXTEND = text("UPDATE app.session SET expires_at = :exp, last_seen_at = now() WHERE id = :sid")


def session_expiry(created_at: datetime, now: datetime | None = None) -> datetime:
    """When a session used `now` ends: the idle window from now, capped by the maximum lifetime."""
    now = now or datetime.now(UTC)
    return min(now + timedelta(hours=SESSION_IDLE_HOURS), created_at + timedelta(days=SESSION_MAX_DAYS))


def _due_extension(row: Any) -> datetime | None:
    target = session_expiry(row[8])
    return target if target - row[6] > _REFRESH_EVERY else None


def _touch(db: Any, sid: str, expires_at: datetime) -> None:
    """Its own short transaction: many requests only read and never commit theirs."""
    try:
        bind = db.get_bind() if hasattr(db, "get_bind") else db
        with getattr(bind, "engine", bind).begin() as conn:
            conn.execute(_EXTEND, {"sid": sid, "exp": expires_at})
    except Exception:  # an extension that fails must never fail the request
        log.warning("session %s… not extended", sid[:8], exc_info=True)


async def _atouch(db: Any, sid: str, expires_at: datetime) -> None:
    try:
        bind = db.bind
        async with getattr(bind, "engine", bind).begin() as conn:
            await conn.execute(_EXTEND, {"sid": sid, "exp": expires_at})
    except Exception:
        log.warning("session %s… not extended", sid[:8], exc_info=True)


def _identity(row: Any, app: str | None) -> SuiteIdentity:
    return SuiteIdentity(
        user_id=row[0],
        email=row[1],
        name=row[2],
        entra_oid=row[3],
        is_global_admin=bool(row[4]),
        session_id=row[5],
        session_expires_at=row[6],
        app=app,
        app_role=row[7],
    )


def _check(app: str, role: str | None) -> None:
    if not is_valid_role(app, role):
        raise SuiteAccessError(f"unknown role {role!r} for app {app!r}")


def _audit_params(actor: str | None, action: str, target: str, app: str | None, detail: dict[str, Any]) -> dict[str, Any]:
    return {"actor": actor, "action": action, "target": target, "app": app, "detail": json.dumps(detail)}


# ---------------------------------------------------------------- sync (EMS, LMS)
def resolve(db: Any, cookie_value: str | None, app: str | None) -> SuiteIdentity | None:
    """Cookie -> active person with a live session (and their role in `app`), else None."""
    if not cookie_value:
        return None
    row = db.execute(_RESOLVE, {"sid": hash_session_id(cookie_value), "app": app or ""}).first()
    if row is None:
        return None
    if (extended := _due_extension(row)) is not None:
        _touch(db, row[5], extended)
    return _identity(row, app)


def mirror_access(
    db: Any,
    *,
    email: str,
    name: str = "",
    app: str,
    role: str | None,
    source: str = "app",
    actor: str | None = None,
    entra_oid: str | None = None,
) -> str:
    """Record `email`'s role in `app` (None = no access) in the caller's transaction.
    Creates the suite person (status invited) when an app admin adds someone new.
    Returns the suite user id."""
    _check(app, role)
    email = email.strip().lower()
    db.execute(_INSERT_USER, {"id": ulid(), "email": email, "name": name or "", "oid": entra_oid, "by": actor})
    uid = db.execute(_FIND_USER, {"email": email}).first()[0]
    db.execute(_FILL_USER, {"id": uid, "name": name or "", "oid": entra_oid})
    before = db.execute(_ACCESS_OF, {"uid": uid, "app": app}).scalar()
    if role is None:
        db.execute(_DELETE_ACCESS, {"uid": uid, "app": app})
    else:
        db.execute(_UPSERT_ACCESS, {"uid": uid, "app": app, "role": role, "source": source, "by": actor})
    if before != role:
        db.execute(_AUDIT, _audit_params(actor, "access_changed", uid, app, {"from": before, "to": role, "source": source}))
    return str(uid)


def access_of(db: Any, user_id: str, app: str) -> str | None:
    return db.execute(_ACCESS_OF, {"uid": user_id, "app": app}).scalar()


def revoke_sessions(db: Any, user_id: str) -> None:
    db.execute(_REVOKE_SESSIONS, {"uid": user_id})


def preferences(db: Any, user_id: str) -> dict[str, str]:
    row = db.execute(_PREFS, {"uid": user_id}).first()
    return {"preset": row[0], "mode": row[1]} if row else {"preset": "linen", "mode": "system"}


# ---------------------------------------------------------------- async (Kanban, portal)
async def aresolve(db: Any, cookie_value: str | None, app: str | None) -> SuiteIdentity | None:
    if not cookie_value:
        return None
    row = (await db.execute(_RESOLVE, {"sid": hash_session_id(cookie_value), "app": app or ""})).first()
    if row is None:
        return None
    if (extended := _due_extension(row)) is not None:
        await _atouch(db, row[5], extended)
    return _identity(row, app)


async def amirror_access(
    db: Any,
    *,
    email: str,
    name: str = "",
    app: str,
    role: str | None,
    source: str = "app",
    actor: str | None = None,
    entra_oid: str | None = None,
) -> str:
    _check(app, role)
    email = email.strip().lower()
    await db.execute(_INSERT_USER, {"id": ulid(), "email": email, "name": name or "", "oid": entra_oid, "by": actor})
    uid = (await db.execute(_FIND_USER, {"email": email})).first()[0]
    await db.execute(_FILL_USER, {"id": uid, "name": name or "", "oid": entra_oid})
    before = (await db.execute(_ACCESS_OF, {"uid": uid, "app": app})).scalar()
    if role is None:
        await db.execute(_DELETE_ACCESS, {"uid": uid, "app": app})
    else:
        await db.execute(_UPSERT_ACCESS, {"uid": uid, "app": app, "role": role, "source": source, "by": actor})
    if before != role:
        await db.execute(_AUDIT, _audit_params(actor, "access_changed", uid, app, {"from": before, "to": role, "source": source}))
    return str(uid)


async def aaccess_of(db: Any, user_id: str, app: str) -> str | None:
    return (await db.execute(_ACCESS_OF, {"uid": user_id, "app": app})).scalar()


async def arevoke_sessions(db: Any, user_id: str) -> None:
    await db.execute(_REVOKE_SESSIONS, {"uid": user_id})
