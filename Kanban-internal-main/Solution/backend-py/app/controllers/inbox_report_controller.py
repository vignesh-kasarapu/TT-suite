"""inbox and reports."""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_inbox_service, get_report_service
from app.schemas.common_schema import Id
from app.schemas.report_schema import (
    InboxClearRequest,
    InboxGroup,
    InboxPage,
    InboxReadRequest,
    OverdueReport,
    ProgressReport,
)
from app.services.inbox_service import InboxQuery, InboxService
from app.services.report_service import ReportService

inbox = APIRouter(prefix="/inbox", tags=["inbox"], route_class=RoleRoute)
reports = APIRouter(prefix="/reports", tags=["reports"], route_class=RoleRoute)

NO_CONTENT = {"status_code": status.HTTP_204_NO_CONTENT, "response_class": Response}


@inbox.get(
    "",
    operation_id="getInbox",
    summary="What changed on my cards and in my teams, newest first, grouped; unread flagged",
    response_model=InboxPage,
    openapi_extra=roles("member"),
)
async def get_inbox(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    team_id: Annotated[
        str | None,
        Query(alias="teamId", max_length=26, description="A team, or `none` for no team."),
    ] = None,
    project_id: Annotated[Id | None, Query(alias="projectId")] = None,
    assigned_to_me: Annotated[bool, Query(alias="assignedToMe")] = False,
    group: Annotated[InboxGroup | None, Query()] = None,
    actor: Actor = Depends(current_actor),
    service: InboxService = Depends(get_inbox_service),
) -> InboxPage:
    query = InboxQuery(team_id, project_id, assigned_to_me, group)
    return await service.page(actor, query, offset, limit)


@inbox.post(
    "/seen",
    operation_id="markInboxSeen",
    summary='Stamp "last looked" now; everything older stops being unread',
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def mark_inbox_seen(
    actor: Actor = Depends(current_actor), service: InboxService = Depends(get_inbox_service)
) -> Response:
    await service.mark_seen(actor)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@inbox.post(
    "/read",
    operation_id="markInboxRead",
    summary="Mark the entries I just opened as read (CR-19)",
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def mark_inbox_read(
    body: InboxReadRequest,
    actor: Actor = Depends(current_actor),
    service: InboxService = Depends(get_inbox_service),
) -> Response:
    await service.mark_read(actor, body.event_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@inbox.post(
    "/clear",
    operation_id="clearInbox",
    summary="Everything at or before this moment leaves my inbox; card history is untouched",
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def clear_inbox(
    body: InboxClearRequest,
    actor: Actor = Depends(current_actor),
    service: InboxService = Depends(get_inbox_service),
) -> Response:
    await service.clear(actor, body.before)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@reports.get(
    "/progress",
    operation_id="getProgressReport",
    summary="Counts per state, effort vs logged, no-ETA and overdue per project/program/person",
    response_model=ProgressReport,
    openapi_extra=roles("member"),
)
async def get_progress_report(
    group_by: Annotated[Literal["project", "program", "person"], Query(alias="groupBy")],
    team_id: Annotated[Id | None, Query(alias="teamId")] = None,
    program_id: Annotated[Id | None, Query(alias="programId")] = None,
    start: Annotated[
        date | None,
        Query(alias="from", description="D-153: period start (with `to`); omit both for all time."),
    ] = None,
    end: Annotated[
        date | None, Query(alias="to", description="D-153: period end, inclusive.")
    ] = None,
    actor: Actor = Depends(current_actor),
    service: ReportService = Depends(get_report_service),
) -> ProgressReport:
    return await service.progress(actor, group_by, team_id, program_id, start, end)


@reports.get(
    "/overdue",
    operation_id="getOverdueReport",
    summary="Open org cards with ETA before today, grouped by team, project or assignee",
    response_model=OverdueReport,
    openapi_extra=roles("member"),
)
async def get_overdue_report(
    group_by: Annotated[Literal["team", "project", "assignee"], Query(alias="groupBy")],
    actor: Actor = Depends(current_actor),
    service: ReportService = Depends(get_report_service),
) -> OverdueReport:
    return await service.overdue(actor, group_by)


@reports.get(
    "/effort.csv",
    operation_id="getEffortExport",
    summary="Hours per person per card per day as CSV - exactly what the caller may see (CR-13)",
    response_class=Response,
    responses={
        200: {"description": "The CSV.", "content": {"text/csv": {"schema": {"type": "string"}}}}
    },
    openapi_extra=roles("member"),
)
async def get_effort_export(
    start: Annotated[date, Query(alias="from")],
    end: Annotated[date, Query(alias="to")],
    team_id: Annotated[Id | None, Query(alias="teamId")] = None,
    program_id: Annotated[Id | None, Query(alias="programId")] = None,
    actor: Actor = Depends(current_actor),
    service: ReportService = Depends(get_report_service),
) -> Response:
    csv = await service.effort_csv(actor, team_id, program_id, start, end)
    return Response(
        content=csv.body,
        media_type="text/csv; charset=utf-8",
        headers={"content-disposition": f'attachment; filename="{csv.filename}"'},
    )
