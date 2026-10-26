"""All SQL the portal runs against schema `suite`. The portal writes people, sessions,
preferences, audit and mail - never `app.app_access` (the apps own that, see the contract)."""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from suite_core.ulid import ulid


@dataclass(frozen=True)
class Person:
    id: str
    email: str
    name: str
    entra_oid: str | None
    status: str
    is_global_admin: bool
    has_photo: bool
    invited_at: datetime | None
    last_login_at: datetime | None


_PERSON_COLS = (
    "u.id, u.email, u.name, u.entra_oid, u.status, u.is_global_admin, "
    "(u.photo IS NOT NULL) AS has_photo, u.invited_at, u.last_login_at"
)


def _person(row: Any) -> Person:
    return Person(*row)


class SuiteRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ---- people
    async def person_by_id(self, user_id: str) -> Person | None:
        row = (await self.db.execute(text(f"SELECT {_PERSON_COLS} FROM app.users u WHERE u.id = :id"), {"id": user_id})).first()
        return _person(row) if row else None

    async def person_by_email(self, email: str) -> Person | None:
        row = (
            await self.db.execute(
                text(f"SELECT {_PERSON_COLS} FROM app.users u WHERE u.email = :e"), {"e": email.strip().lower()}
            )
        ).first()
        return _person(row) if row else None

    async def person_for_sign_in(self, oid: str | None, email: str) -> Person | None:
        """The Entra object id wins; the work email finds an invited person on first sign-in."""
        if oid:
            row = (
                await self.db.execute(text(f"SELECT {_PERSON_COLS} FROM app.users u WHERE u.entra_oid = :o"), {"o": oid})
            ).first()
            if row:
                return _person(row)
        return await self.person_by_email(email)

    async def insert_person(self, *, email: str, name: str, invited_by: str | None, is_global_admin: bool = False) -> str:
        uid = ulid()
        await self.db.execute(
            text(
                "INSERT INTO app.users (id, email, name, status, is_global_admin, invited_by, invited_at)"
                " VALUES (:id, :e, :n, 'invited', :g, :by, now())"
            ),
            {"id": uid, "e": email.strip().lower(), "n": name, "g": is_global_admin, "by": invited_by},
        )
        return uid

    async def update_person(self, user_id: str, **fields: Any) -> None:
        allowed = {"name", "status", "is_global_admin", "entra_oid", "last_login_at", "photo", "photo_type"}
        sets = {k: v for k, v in fields.items() if k in allowed}
        if not sets:
            return
        assignments = ", ".join(f"{k} = :{k}" for k in sets)
        await self.db.execute(
            text(f"UPDATE app.users SET {assignments}, updated_at = now() WHERE id = :id"), {**sets, "id": user_id}
        )

    async def list_people(self, q: str | None = None) -> list[Person]:
        where, params = "", {}
        if q:
            where, params = "WHERE u.email ILIKE :q OR u.name ILIKE :q", {"q": f"%{q.strip()}%"}
        rows = await self.db.execute(text(f"SELECT {_PERSON_COLS} FROM app.users u {where} ORDER BY lower(u.name), u.email"), params)
        return [_person(r) for r in rows]

    async def global_admins(self) -> list[Person]:
        rows = await self.db.execute(
            text(f"SELECT {_PERSON_COLS} FROM app.users u WHERE u.is_global_admin AND u.status <> 'inactive'")
        )
        return [_person(r) for r in rows]

    async def photo(self, user_id: str) -> tuple[str, bytes] | None:
        row = (await self.db.execute(text("SELECT photo_type, photo FROM app.users WHERE id = :id"), {"id": user_id})).first()
        return (row[0] or "image/jpeg", bytes(row[1])) if row and row[1] else None

    # ---- access (read only)
    async def access_of(self, user_id: str) -> dict[str, str | None]:
        out: dict[str, str | None] = {"kanban": None, "lms": None, "expense": None}
        rows = await self.db.execute(text("SELECT app, role FROM app.app_access WHERE user_id = :u"), {"u": user_id})
        for app, role in rows:
            out[app] = role
        return out

    async def access_all(self) -> dict[str, dict[str, str]]:
        out: dict[str, dict[str, str]] = {}
        for uid, app, role in await self.db.execute(text("SELECT user_id, app, role FROM app.app_access")):
            out.setdefault(uid, {})[app] = role
        return out

    # ---- sessions
    async def insert_session(self, session_hash: str, user_id: str, expires_at: datetime) -> None:
        await self.db.execute(
            text("INSERT INTO app.session (id, user_id, expires_at) VALUES (:id, :u, :e)"),
            {"id": session_hash, "u": user_id, "e": expires_at},
        )

    async def delete_session(self, session_hash: str) -> None:
        await self.db.execute(text("DELETE FROM app.session WHERE id = :id"), {"id": session_hash})

    async def delete_sessions_of(self, user_id: str) -> None:
        await self.db.execute(text("DELETE FROM app.session WHERE user_id = :u"), {"u": user_id})

    async def purge_expired_sessions(self) -> None:
        await self.db.execute(text("DELETE FROM app.session WHERE expires_at < now()"))

    # ---- preferences
    async def preferences(self, user_id: str) -> dict[str, str]:
        row = (await self.db.execute(text("SELECT preset, mode FROM app.user_preference WHERE user_id = :u"), {"u": user_id})).first()
        return {"preset": row[0], "mode": row[1]} if row else {"preset": "linen", "mode": "system"}

    async def save_preferences(self, user_id: str, preset: str, mode: str) -> None:
        await self.db.execute(
            text(
                "INSERT INTO app.user_preference (user_id, preset, mode) VALUES (:u, :p, :m)"
                " ON CONFLICT (user_id) DO UPDATE SET preset = EXCLUDED.preset, mode = EXCLUDED.mode, updated_at = now()"
            ),
            {"u": user_id, "p": preset, "m": mode},
        )

    # ---- audit
    async def audit(self, *, actor_id: str | None, action: str, target_id: str | None = None,
                    app: str | None = None, detail: dict[str, Any] | None = None) -> None:
        await self.db.execute(
            text(
                "INSERT INTO app.audit_log (actor_id, action, target_id, app, detail)"
                " VALUES (:a, :act, :t, :app, CAST(:d AS jsonb))"
            ),
            {"a": actor_id, "act": action, "t": target_id, "app": app, "d": json.dumps(detail or {})},
        )

    async def audit_page(self, limit: int) -> list[dict[str, Any]]:
        rows = await self.db.execute(
            text(
                "SELECT l.id, l.at, l.action, l.app, l.detail, a.name, a.email, t.name, t.email"
                "  FROM app.audit_log l"
                "  LEFT JOIN app.users a ON a.id = l.actor_id"
                "  LEFT JOIN app.users t ON t.id = l.target_id"
                " ORDER BY l.at DESC, l.id DESC LIMIT :n"
            ),
            {"n": limit},
        )
        return [
            {
                "id": r[0], "at": r[1], "action": r[2], "app": r[3], "detail": r[4],
                "actor": r[5] or r[6], "target": r[7] or r[8],
            }
            for r in rows
        ]

    # ---- mail outbox
    async def enqueue_mail(self, to_email: str, kind: str, payload: dict[str, Any]) -> None:
        await self.db.execute(
            text("INSERT INTO app.mail_outbox (to_email, kind, payload) VALUES (:t, :k, CAST(:p AS jsonb))"),
            {"t": to_email, "k": kind, "p": json.dumps(payload)},
        )

    async def due_mail(self, limit: int = 20) -> list[tuple[int, str, str, dict[str, Any], int]]:
        rows = await self.db.execute(
            text(
                "SELECT id, to_email, kind, payload, attempts FROM app.mail_outbox"
                " WHERE status = 'pending' AND next_attempt_at <= now()"
                " ORDER BY id LIMIT :n FOR UPDATE SKIP LOCKED"
            ),
            {"n": limit},
        )
        return [(r[0], r[1], r[2], r[3], r[4]) for r in rows]

    async def mail_sent(self, mail_id: int) -> None:
        await self.db.execute(
            text("UPDATE app.mail_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = :id"),
            {"id": mail_id},
        )

    async def mail_failed(self, mail_id: int, error: str, give_up: bool, retry_in_s: int) -> None:
        await self.db.execute(
            text(
                "UPDATE app.mail_outbox SET attempts = attempts + 1, last_error = :e,"
                " status = CASE WHEN :g THEN 'failed' ELSE 'pending' END,"
                " next_attempt_at = now() + make_interval(secs => :s) WHERE id = :id"
            ),
            {"id": mail_id, "e": error[:500], "g": give_up, "s": retry_in_s},
        )

    async def recent_mail(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = await self.db.execute(
            text(
                "SELECT id, to_email, kind, payload, status, created_at, last_error"
                " FROM app.mail_outbox ORDER BY id DESC LIMIT :n"
            ),
            {"n": limit},
        )
        return [
            {"id": r[0], "to": r[1], "kind": r[2], "payload": r[3], "status": r[4], "createdAt": r[5], "lastError": r[6]}
            for r in rows
        ]
