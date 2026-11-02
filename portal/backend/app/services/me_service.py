"""The signed-in person: dashboard data, theme preferences, launching an app, asking for access."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError
from app.repositories.suite_repository import Person, SuiteRepository
from app.services.apps_client import AppsClient
from app.services.personal_details import personal_detail_changes
from suite_core import inbox
from suite_core.constants import APP_PATHS, APP_ROLES, APP_TITLES, HIDDEN_UNLESS_GRANTED, active_apps, is_active
from suite_core.cookies import hash_session_id
from suite_core.provision import AuthorizeRequest, ProvisionRequest

PRESETS = ("linen", "harbour", "graphite")
PHOTO_TYPES = ("image/png", "image/jpeg", "image/webp")
PHOTO_MAX_BYTES = 2 * 1024 * 1024
MODES = ("system", "light", "dark")


class MeService:
    def __init__(self, db: AsyncSession, settings: Settings, apps: AppsClient) -> None:
        self.db = db
        self.repo = SuiteRepository(db)
        self.settings = settings
        self.apps = apps

    async def me(self, person: Person) -> dict[str, Any]:
        return {
            "id": person.id,
            "email": person.email,
            "name": person.name or person.email,
            "employeeCode": person.employee_code,
            "isGlobalAdmin": person.is_global_admin,
            "photoUrl": "/api/me/photo" if person.has_photo else None,
            **await self.repo.profile_details(person.id),
            "access": await self.access(person),
            "apps": list(active_apps()),  # this deployment's apps (SUITE_SKIP leaves some out)
            "preferences": await self.repo.preferences(person.id),
            "unreadCount": await self.repo.unread_count(person.id),
        }

    async def access(self, person: Person) -> dict[str, str | None]:
        """The person's role per app. A global admin always holds the hidden-unless-granted apps
        (the Resume Evaluator) as admin; the role is provisioned there on first launch."""
        held = await self.repo.access_of(person.id)
        if person.is_global_admin:
            for app in HIDDEN_UNLESS_GRANTED:
                if is_active(app):
                    held[app] = held.get(app) or "admin"
        return held

    async def sessions(self, person: Person, cookie_value: str | None) -> list[dict[str, Any]]:
        """The devices this person is signed in on (the current one marked)."""
        current = hash_session_id(cookie_value) if cookie_value else None
        return [
            {**{k: v for k, v in s.items() if k != "id"}, "key": s["id"][:16], "current": s["id"] == current}
            for s in await self.repo.sessions_of(person.id)
        ]

    async def end_session(self, person: Person, key: str, cookie_value: str | None) -> None:
        """Sign one of the person's other devices out (Profile, "Signed in on")."""
        current = hash_session_id(cookie_value) if cookie_value else None
        match = [s["id"] for s in await self.repo.sessions_of(person.id) if s["id"][:16] == key]
        if not match:
            raise AppError(404, "NOT_FOUND", "That device is already signed out.")
        if match[0] == current:
            raise AppError(409, "CURRENT_SESSION", "Use Sign out to sign out of this device.")
        await self.repo.delete_session(match[0])
        await self.db.commit()

    async def set_photo(self, person: Person, content_type: str, data: bytes | None) -> dict[str, Any]:
        """Upload (or with data None, remove) the person's own photo; Graph no longer replaces it."""
        if data is not None:
            if content_type not in PHOTO_TYPES:
                raise AppError(415, "PHOTO_TYPE", "Choose a PNG, JPEG or WebP image.")
            if not data or len(data) > PHOTO_MAX_BYTES:
                raise AppError(413, "PHOTO_SIZE", "Choose an image of 2 MB or less.")
        await self.repo.update_person(person.id, photo=data, photo_type=content_type if data else None, photo_uploaded=True)
        await self.repo.audit(actor_id=person.id, action="person_updated", target_id=person.id,
                              detail={"photo": "uploaded" if data else "removed"})
        await self.db.commit()
        fresh = await self.repo.person_by_id(person.id)
        assert fresh is not None
        return await self.me(fresh)

    async def inbox(self, person: Person) -> dict[str, Any]:
        return {"items": await self.repo.inbox(person.id), "unreadCount": await self.repo.unread_count(person.id)}

    async def mark_read(self, person: Person, ids: list[int] | None) -> None:
        await self.repo.mark_read(person.id, ids)
        await self.db.commit()

    async def update_profile(self, person: Person, name: str, **details: Any) -> dict[str, Any]:
        """The one place a person edits their own details.

        Every app copies what it keeps on the person's next request (each app's sign-in
        check), so one edit here shows everywhere — nothing is sent to the apps from here.
        Any detail left out (None) keeps its current value. Employment data is not editable
        here: department, grade, manager, region and roles belong to the app that owns them.
        """
        clean = " ".join(name.split())
        if not clean:
            raise AppError(422, "VALIDATION", "Enter your name.")
        changes: dict[str, Any] = {"name": clean}
        if clean != person.name:
            changes["name_edited"] = True

        # The same rules a global admin's edit goes through (admin_service.update_person).
        changes.update(personal_detail_changes(details))
        await self.repo.update_person(person.id, **changes)
        await self.repo.audit(actor_id=person.id, action="person_updated", target_id=person.id,
                              detail={k: v for k, v in changes.items() if k != "name_edited"})
        await self.db.commit()
        fresh = await self.repo.person_by_id(person.id)
        assert fresh is not None
        return await self.me(fresh)

    async def save_preferences(self, person: Person, preset: str, mode: str) -> dict[str, str]:
        if preset not in PRESETS or mode not in MODES:
            raise AppError(422, "VALIDATION", "Unknown theme.")
        await self.repo.save_preferences(person.id, preset, mode)
        await self.db.commit()
        return {"preset": preset, "mode": mode}

    async def launch(self, person: Person, app: str) -> str:
        """Dashboard card click: authorize the person's role in `app`, then where to go."""
        if app not in APP_ROLES or not is_active(app):
            raise AppError(404, "NOT_FOUND", "No such app.")
        role = (await self.repo.access_of(person.id)).get(app)
        if role is None and person.is_global_admin and app in HIDDEN_UNLESS_GRANTED:
            try:
                await self.apps.provision(app, ProvisionRequest(
                    email=person.email, name=person.name, entra_oid=person.entra_oid, role="admin",
                    source="global", actor_id=person.id))
            except AppError as err:
                if err.code == "APP_UNAVAILABLE":
                    return f"/?unavailable={app}"
                raise
            role = "admin"
        if role is None:
            await self.repo.audit(actor_id=person.id, action="app_launch_denied", target_id=person.id, app=app)
            await self.db.commit()
            return f"/?denied={app}"
        try:
            result = await self.apps.authorize(
                app, AuthorizeRequest(suite_user_id=person.id, email=person.email, name=person.name, entra_oid=person.entra_oid)
            )
        except AppError as err:
            if err.code == "APP_UNAVAILABLE":
                return f"/?unavailable={app}"
            raise
        if not result.allowed:
            await self.repo.audit(actor_id=person.id, action="app_launch_denied", target_id=person.id, app=app,
                                  detail={"code": result.code})
            await self.db.commit()
            return f"/?denied={app}"
        await self.repo.audit(actor_id=person.id, action="app_launch", target_id=person.id, app=app, detail={"role": result.role})
        await self.db.commit()
        return f"{APP_PATHS[app]}/"

    async def request_access(self, person: Person, app: str, message: str) -> None:
        if app not in APP_ROLES or app in HIDDEN_UNLESS_GRANTED or not is_active(app):
            raise AppError(404, "NOT_FOUND", "No such app.")
        payload = {
            "name": person.name or person.email, "email": person.email, "app": app,
            "message": message.strip()[:1000], "url": f"{self.settings.PUBLIC_BASE_URL}/admin",
        }
        for admin in await self.repo.global_admins():
            await self.repo.enqueue_mail(admin.email, "request_access", payload)
        # Also a role request for the app's first role, waiting in the global admins' inbox, where
        # it is approved (or the role adjusted) in one click.
        await inbox.arequest_role_change(self.db, app=app, email=person.email, role=APP_ROLES[app][0],
                                         requested_by=person.id, note=message)
        await inbox.anotify(self.db, person.id, "access_requested",
                            f"You asked for access to {APP_TITLES[app]}", "The global admin has been told.")
        await self.repo.audit(actor_id=person.id, action="access_requested", target_id=person.id, app=app)
        await self.db.commit()
