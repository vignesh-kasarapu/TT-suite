"""In-process outbox sender (D-073): every 30 s it first queues any weekly time mail that is due
(D-116, FR-084..086), then drains the outbox. Not started in the test profile, where tests run
both on demand through POST /dev/time-mails/run and POST /dev/notifications/run."""

import asyncio

from fastapi import FastAPI

from app.core.database import UnitOfWork
from app.core.logging import get_logger
from app.repositories.mail_template_repository import MailTemplateRepository
from app.repositories.notification_repository import NotificationRepository
from app.repositories.team_repository import TeamRepository
from app.repositories.timelog_repository import TimeLogRepository
from app.repositories.user_repository import UserRepository
from app.services.notification_service import NotificationService
from app.services.timelog_service import TimeLogService

INTERVAL_SECONDS = 30


async def time_mails_once(app: FastAPI) -> None:
    async with app.state.sessionmaker() as session:
        await TimeLogService(
            UnitOfWork(session),
            TimeLogRepository(session),
            NotificationRepository(session),
            app.state.settings,
            app.state.clock,
        ).run_due()


async def drain_once(app: FastAPI) -> None:
    async with app.state.sessionmaker() as session:
        service = NotificationService(
            UnitOfWork(session),
            NotificationRepository(session),
            UserRepository(session),
            TeamRepository(session),
            app.state.graph,
            app.state.http,
            app.state.settings,
            app.state.clock,
            MailTemplateRepository(session),
        )
        await service.drain()


async def run(app: FastAPI, every: float = INTERVAL_SECONDS) -> None:
    while True:
        await asyncio.sleep(every)
        try:
            await time_mails_once(app)
            await drain_once(app)
        except Exception as err:  # a failed tick must not stop the loop
            get_logger().error("notify_worker", code="NOTIFY_WORKER", err=err)
