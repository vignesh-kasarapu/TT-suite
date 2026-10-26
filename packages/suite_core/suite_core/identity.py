"""Suite identity in the shared database: resolve a cookie to a person + their role in one app,
and mirror an app's own user/role change into `app.app_access`.

Every function takes the caller's open SQLAlchemy connection or session, so it runs inside the
caller's transaction: an app's role change and its mirror commit (or roll back) together.
Sync functions take a `Session`/`Connection`; the `a`-prefixed twins take the async versions.

Rule: only the owning app writes `app.app_access` (see 0001_suite.up.sql).
"""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text

from suite_core.constants import is_valid_role
from suite_core.cookies import hash_session_id
from suite_core.ulid import ulid


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
           a.role
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
    return _identity(row, app) if row else None


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
    return _identity(row, app) if row else None


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
