"""The signed-in person: dashboard data, theme preferences, launching an app, asking for access."""

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError
from app.repositories.suite_repository import Person, SuiteRepository
from app.services.apps_client import AppsClient
from suite_core.constants import APP_PATHS, APP_ROLES
from suite_core.provision import AuthorizeRequest

PRESETS = ("linen", "harbour", "graphite")
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
            "isGlobalAdmin": person.is_global_admin,
            "photoUrl": "/api/me/photo" if person.has_photo else None,
            "access": await self.repo.access_of(person.id),
            "preferences": await self.repo.preferences(person.id),
        }

    async def save_preferences(self, person: Person, preset: str, mode: str) -> dict[str, str]:
        if preset not in PRESETS or mode not in MODES:
            raise AppError(422, "VALIDATION", "Unknown theme.")
        await self.repo.save_preferences(person.id, preset, mode)
        await self.db.commit()
        return {"preset": preset, "mode": mode}

    async def launch(self, person: Person, app: str) -> str:
        """Dashboard card click: authorize the person's role in `app`, then where to go."""
        if app not in APP_ROLES:
            raise AppError(404, "NOT_FOUND", "No such app.")
        role = (await self.repo.access_of(person.id)).get(app)
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
        if app not in APP_ROLES:
            raise AppError(404, "NOT_FOUND", "No such app.")
        payload = {
            "name": person.name or person.email, "email": person.email, "app": app,
            "message": message.strip()[:1000], "url": f"{self.settings.PUBLIC_BASE_URL}/admin",
        }
        for admin in await self.repo.global_admins():
            await self.repo.enqueue_mail(admin.email, "request_access", payload)
        await self.repo.audit(actor_id=person.id, action="access_requested", target_id=person.id, app=app)
        await self.db.commit()
