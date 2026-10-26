"""Health (NFR-009), the dev clock (NFR-008) and the boot seed."""

from datetime import datetime

from app.core.clock import Clock, FakeClock
from app.core.config import Settings
from app.core.database import UnitOfWork
from app.core.logging import get_logger
from app.repositories.suite_repository import SuiteRepository
from app.repositories.system_repository import SystemRepository
from app.repositories.user_repository import UserRepository
from app.schemas.system_schema import Health
from app.utils.ulid import ulid


class HealthService:
    def __init__(self, system: SystemRepository, settings: Settings) -> None:
        self.system = system
        self.settings = settings

    async def check(self) -> tuple[int, Health]:
        """200 ok, or 503 degraded when the database is unreachable. Production omits the
        version."""
        up = await self.system.ping()
        health = Health(status="ok" if up else "degraded", db="ok" if up else "down")
        if self.settings.APP_PROFILE != "prod":
            health.version = self.settings.APP_VERSION
        return (200 if up else 503), health


class DevClockService:
    """PUT/DELETE /dev/clock - only mounted outside prod, where the clock is a FakeClock."""

    def __init__(self, clock: Clock) -> None:
        if not isinstance(clock, FakeClock):
            raise RuntimeError("the dev clock needs a FakeClock (dev/test profile)")
        self.clock = clock

    def set(self, now: datetime) -> None:
        self.clock.set(now)

    def clear(self) -> None:
        self.clock.clear()


class SeedService:
    """Boot seed, idempotent: SEED_ADMIN_EMAIL becomes an admin, created if absent. The admin is
    mirrored to `app.app_access` (SUITE-CONTRACT §3.3) in the same transaction, so the portal
    lets them in to Kanban."""

    def __init__(
        self, uow: UnitOfWork, users: UserRepository, suite: SuiteRepository, clock: Clock
    ) -> None:
        self.uow = uow
        self.users = users
        self.suite = suite
        self.clock = clock

    async def _mirror_admin(self, user_id: str) -> None:
        user = await self.users.link_of(user_id)
        if user is None or user.status == "inactive":
            return
        suite_id = await self.suite.mirror(
            email=user.email,
            name=user.name,
            role="admin",
            source="app",
            actor=None,
            entra_oid=user.external_id,
        )
        if user.suite_user_id != suite_id:
            await self.users.set_suite_user_id(user.id, suite_id)

    async def seed_admin(self, email: str) -> bool:
        email = email.strip().lower()
        if not email:
            return False
        now = self.clock.now()
        existing = await self.users.find_role_by_email(email)
        if existing:
            if existing[1] != "admin":
                await self.users.set_role(existing[0], "admin", now)
            await self._mirror_admin(existing[0])
            await self.uow.commit()
            return False
        user_id = ulid(now)
        await self.users.insert(
            user_id=user_id, email=email, name=email.split("@")[0], role="admin"
        )
        await self._mirror_admin(user_id)
        await self.uow.commit()
        get_logger().info("seed", code="SEED_ADMIN_CREATED", actorId=user_id)
        return True
