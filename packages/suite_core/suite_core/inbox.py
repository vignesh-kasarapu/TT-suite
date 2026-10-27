"""The suite inbox and role-change requests (app.message, app.role_request; 0003).

Only a global admin assigns roles. An app admin who wants a change asks for it from their app's
user management: `request_role_change` records the request and tells every global admin in the
inbox. The portal shows it there; approving applies it through the app's /internal/provision.

Like `identity`, every function runs in the caller's transaction; the `a`-prefixed twins take an
async session/connection.
"""

import json
from collections.abc import Sequence
from typing import Any

from sqlalchemy import text

from suite_core.constants import APP_TITLES, is_valid_role
from suite_core.identity import SuiteAccessError

INBOX_LINK = "/inbox"

_MESSAGE = text(
    "INSERT INTO app.message (user_id, kind, title, body, link) VALUES (:user_id, :kind, :title, :body, :link)"
)
_GLOBAL_ADMINS = text("SELECT id FROM app.users WHERE is_global_admin AND status <> 'inactive'")
_PERSON = text("SELECT id, name, email FROM app.users WHERE email = :email")
_NAME_OF = text("SELECT COALESCE(NULLIF(name, ''), email) FROM app.users WHERE id = :id")
_CANCEL_OPEN = text(
    "UPDATE app.role_request SET status = 'cancelled', decided_at = now()"
    " WHERE app = :app AND user_id = :user_id AND status = 'pending'"
)
_INSERT_REQUEST = text(
    """
    INSERT INTO app.role_request (app, user_id, role, lead_team_ids, note, requested_by)
    VALUES (:app, :user_id, :role, CAST(:teams AS jsonb), :note, :by)
    RETURNING id
    """
)
_AUDIT = text(
    "INSERT INTO app.audit_log (actor_id, action, target_id, app, detail)"
    " VALUES (:actor, 'role_change_requested', :target, :app, CAST(:detail AS jsonb))"
)
_PENDING = text(
    """
    SELECT r.id, u.email, r.role, r.created_at, COALESCE(NULLIF(b.name, ''), b.email)
      FROM app.role_request r
      JOIN app.users u ON u.id = r.user_id
      LEFT JOIN app.users b ON b.id = r.requested_by
     WHERE r.app = :app AND r.status = 'pending'
     ORDER BY r.created_at
    """
)


def role_label(role: str | None) -> str:
    return role.capitalize() if role else "No access"


def _request_params(app: str, person: Any, role: str | None, requested_by: str | None, note: str,
                    lead_team_ids: Sequence[str]) -> dict[str, Any]:
    return {"app": app, "user_id": person[0], "role": role, "teams": json.dumps(list(lead_team_ids)),
            "note": note.strip()[:1000], "by": requested_by}


def _admin_message(app: str, person: Any, role: str | None, requester: str, note: str) -> dict[str, Any]:
    who = person[1] or person[2]
    return {
        "kind": "role_request",
        "title": f"{requester} asks: {who} → {role_label(role)} in {APP_TITLES[app]}",
        "body": note.strip()[:1000],
        "link": INBOX_LINK,
    }


def _validate(app: str, role: str | None) -> None:
    if app not in APP_TITLES or not is_valid_role(app, role):
        raise SuiteAccessError(f"unknown role {role!r} for app {app!r}")


# ---------------------------------------------------------------- sync (EMS, LMS, AMS)
def notify(db: Any, user_id: str, kind: str, title: str, body: str = "", link: str | None = None) -> None:
    db.execute(_MESSAGE, {"user_id": user_id, "kind": kind, "title": title, "body": body, "link": link})


def notify_global_admins(db: Any, kind: str, title: str, body: str = "", link: str | None = INBOX_LINK) -> None:
    for (admin_id,) in db.execute(_GLOBAL_ADMINS).all():
        notify(db, admin_id, kind, title, body, link)


def request_role_change(db: Any, *, app: str, email: str, role: str | None, requested_by: str | None,
                        note: str = "", lead_team_ids: Sequence[str] = ()) -> int:
    """Record a request (replacing an open one for the same person and app) and tell the global
    admins. `requested_by` is the asker's suite user id. Returns the request id."""
    _validate(app, role)
    person = db.execute(_PERSON, {"email": email.strip().lower()}).first()
    if person is None:
        raise SuiteAccessError(f"{email} is not in the suite")
    db.execute(_CANCEL_OPEN, {"app": app, "user_id": person[0]})
    request_id = db.execute(_INSERT_REQUEST, _request_params(app, person, role, requested_by, note, lead_team_ids)).scalar_one()
    db.execute(_AUDIT, {"actor": requested_by, "target": person[0], "app": app,
                        "detail": json.dumps({"role": role, "request": request_id})})
    requester = db.execute(_NAME_OF, {"id": requested_by}).scalar() if requested_by else "Someone"
    msg = _admin_message(app, person, role, requester or "Someone", note)
    notify_global_admins(db, msg["kind"], msg["title"], msg["body"], msg["link"])
    return int(request_id)


def pending_requests(db: Any, app: str) -> list[dict[str, Any]]:
    """Open requests for `app`, for the app's user management to show "requested"."""
    return [
        {"id": r[0], "email": r[1], "role": r[2], "requested_at": r[3], "requested_by": r[4]}
        for r in db.execute(_PENDING, {"app": app}).all()
    ]


# ---------------------------------------------------------------- async (Kanban, portal)
async def anotify(db: Any, user_id: str, kind: str, title: str, body: str = "", link: str | None = None) -> None:
    await db.execute(_MESSAGE, {"user_id": user_id, "kind": kind, "title": title, "body": body, "link": link})


async def anotify_global_admins(db: Any, kind: str, title: str, body: str = "", link: str | None = INBOX_LINK) -> None:
    for (admin_id,) in (await db.execute(_GLOBAL_ADMINS)).all():
        await anotify(db, admin_id, kind, title, body, link)


async def arequest_role_change(db: Any, *, app: str, email: str, role: str | None, requested_by: str | None,
                               note: str = "", lead_team_ids: Sequence[str] = ()) -> int:
    _validate(app, role)
    person = (await db.execute(_PERSON, {"email": email.strip().lower()})).first()
    if person is None:
        raise SuiteAccessError(f"{email} is not in the suite")
    await db.execute(_CANCEL_OPEN, {"app": app, "user_id": person[0]})
    request_id = (await db.execute(_INSERT_REQUEST, _request_params(app, person, role, requested_by, note, lead_team_ids))).scalar_one()
    await db.execute(_AUDIT, {"actor": requested_by, "target": person[0], "app": app,
                              "detail": json.dumps({"role": role, "request": request_id})})
    requester = (await db.execute(_NAME_OF, {"id": requested_by})).scalar() if requested_by else "Someone"
    msg = _admin_message(app, person, role, requester or "Someone", note)
    await anotify_global_admins(db, msg["kind"], msg["title"], msg["body"], msg["link"])
    return int(request_id)


async def apending_requests(db: Any, app: str) -> list[dict[str, Any]]:
    return [
        {"id": r[0], "email": r[1], "role": r[2], "requested_at": r[3], "requested_by": r[4]}
        for r in (await db.execute(_PENDING, {"app": app})).all()
    ]
