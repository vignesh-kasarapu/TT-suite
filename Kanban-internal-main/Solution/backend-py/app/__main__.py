"""`python -m app`: boot the server (migrate -> seed -> listen)."""

import asyncio
import sys

import uvicorn
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import Clock
from app.core.config import Settings, load_settings
from app.core.database import UnitOfWork
from app.core.logging import configure_logging, get_logger
from app.db.migrate import app_role_of, migrate_up
from app.main import create_app
from app.repositories.event_repository import EventRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.preference_repository import PreferenceRepository
from app.repositories.suite_repository import SuiteRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository
from app.services.suite_service import SuiteService
from app.services.system_service import SeedService


def suite_service(session: AsyncSession, settings: Settings, clock: Clock) -> SuiteService:
    return SuiteService(
        UnitOfWork(session),
        SuiteRepository(session),
        UserRepository(session),
        TeamRepository(session),
        PreferenceRepository(session),
        EventRepository(session),
        NotificationRepository(session),
        settings,
        clock,
    )


async def serve() -> None:
    settings = load_settings()
    configure_logging(settings.LOG_LEVEL)
    log = get_logger()
    log.info("boot", config=settings.public_config())
    applied = migrate_up(settings.DATABASE_OWNER_URL, app_role_of(settings.DATABASE_URL))
    log.info("migrated", applied=applied, counts={"migrations": len(applied)})
    app = create_app(settings)
    async with app.state.sessionmaker() as session:
        await SeedService(
            UnitOfWork(session), UserRepository(session), SuiteRepository(session), app.state.clock
        ).seed_admin(settings.SEED_ADMIN_EMAIL)
        # TT Suite (SUITE-CONTRACT §3.3): Kanban's existing people keep their access.
        mirrored = await suite_service(session, settings, app.state.clock).backfill()
        log.info("suite_backfill", counts={"mirrored": mirrored})
    config = uvicorn.Config(
        app,
        # TT Suite (SUITE-CONTRACT §1): behind the portal gateway on 127.0.0.1 only; a
        # stand-alone container sets BIND_HOST=0.0.0.0.
        host=settings.BIND_HOST,
        port=settings.PORT,
        log_config=None,
        access_log=False,
        # The portal gateway (127.0.0.1) forwards X-Forwarded-For/-Proto (SUITE-CONTRACT §1).
        proxy_headers=True,
        forwarded_allow_ips="127.0.0.1",
    )
    await uvicorn.Server(config).serve()


def main() -> None:
    try:
        if sys.platform == "win32":
            # psycopg's async driver needs the selector event loop on Windows.
            asyncio.run(serve(), loop_factory=asyncio.SelectorEventLoop)
        else:
            asyncio.run(serve())
    except Exception as err:
        # Boot refusals must be readable in the container log without secrets.
        print(str(err), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
