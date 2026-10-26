"""operations: health for platform probes; dev: the clock override (never mounted in prod)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.dependencies.auth import RoleRoute, roles
from app.dependencies.services import (
    get_dev_clock_service,
    get_health_service,
    get_notification_service,
    get_timelog_service,
)
from app.schemas.report_schema import DrainResult, NotificationList, StubMailList
from app.schemas.system_schema import ClockOverrideRequest, Health
from app.schemas.time_schema import TimeMailJob, TimeMailRunResult
from app.services.notification_service import NotificationService
from app.services.system_service import DevClockService, HealthService
from app.services.timelog_service import TimeLogService

router = APIRouter(tags=["operations"], route_class=RoleRoute)
dev_router = APIRouter(prefix="/dev", tags=["dev"], route_class=RoleRoute)


@router.get(
    "/health",
    operation_id="getHealth",
    summary="Health for platform probes - database reachability",
    response_model=Health,
    response_model_exclude_unset=True,
    responses={503: {"model": Health, "description": "Degraded."}},
    openapi_extra=roles("anonymous"),
)
async def get_health(
    response: Response, service: HealthService = Depends(get_health_service)
) -> Health:
    response.status_code, health = await service.check()
    return health


@dev_router.put(
    "/clock",
    operation_id="setClockOverride",
    summary='Override "now" for deterministic tests',
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    openapi_extra=roles("dev"),
)
async def set_clock_override(
    body: ClockOverrideRequest, service: DevClockService = Depends(get_dev_clock_service)
) -> Response:
    service.set(body.now)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@dev_router.delete(
    "/clock",
    operation_id="clearClockOverride",
    summary="Return to the real clock",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    openapi_extra=roles("dev"),
)
async def clear_clock_override(
    service: DevClockService = Depends(get_dev_clock_service),
) -> Response:
    service.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- dev only: the notification outbox and the stub mailbox (S3b)
@dev_router.get(
    "/notifications",
    operation_id="listDevNotifications",
    summary="The notification outbox (dev/test only)",
    response_model=NotificationList,
    openapi_extra=roles("dev"),
)
async def list_dev_notifications(
    service: NotificationService = Depends(get_notification_service),
) -> NotificationList:
    return await service.outbox()


@dev_router.post(
    "/notifications/run",
    operation_id="runDevNotifications",
    summary="Drain the outbox now (dev/test only)",
    response_model=DrainResult,
    openapi_extra=roles("dev"),
)
async def run_dev_notifications(
    service: NotificationService = Depends(get_notification_service),
) -> DrainResult:
    return await service.drain()


@dev_router.get(
    "/mail",
    operation_id="listDevMail",
    summary='Messages the stub mailer "sent" (dev/test only)',
    response_model=StubMailList,
    openapi_extra=roles("dev"),
)
async def list_dev_mail(
    service: NotificationService = Depends(get_notification_service),
) -> StubMailList:
    return await service.mailbox()


@dev_router.post(
    "/time-mails/run",
    operation_id="runDevTimeMails",
    summary="Run a weekly time-mail job now for the week it covers at this clock (dev/test only)",
    response_model=TimeMailRunResult,
    openapi_extra=roles("dev"),
)
async def run_dev_time_mails(
    job: Annotated[TimeMailJob, Query()],
    service: TimeLogService = Depends(get_timelog_service),
) -> TimeMailRunResult:
    return await service.run_now(job)
