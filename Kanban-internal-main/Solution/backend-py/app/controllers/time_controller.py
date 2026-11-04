"""time log (D-116): my week, week note, days off, and the team time page."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_timelog_service
from app.schemas.common_schema import Id
from app.schemas.time_schema import (
        MyWeek,
    TeamWeek,
    TimeTeamList,
    WeekNoteRequest,
)
from app.services.timelog_service import TimeLogService

router = APIRouter(tags=["time"], route_class=RoleRoute)

NO_CONTENT = {"status_code": status.HTTP_204_NO_CONTENT, "response_class": Response}
Month = Annotated[
    str | None,
    Query(
        pattern=r"^\d{4}-(0[1-9]|1[0-2])$",
        description="YYYY-MM: the whole calendar month instead of a week (D-120).",
    ),
]
Week = Annotated[
    date | None,
    Query(description="Any date in the week; default this week (ORG_TZ)."),
]


@router.get(
    "/me/time",
    operation_id="getMyTime",
    summary="My week: hours per day against 8 h, total against the target, entries, note",
    response_model=MyWeek,
    openapi_extra=roles("member"),
)
async def get_my_time(
    week: Week = None,
    month: Month = None,
    actor: Actor = Depends(current_actor),
    service: TimeLogService = Depends(get_timelog_service),
) -> MyWeek:
    return await service.my_week(actor, week, month)


@router.put(
    "/me/time/weeks/{weekStart}/note",
    operation_id="setWeekNote",
    summary="Set (or, with an empty note, remove) my note for a week",
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def set_week_note(
    week_start: Annotated[date, Path(alias="weekStart", description="The week's Monday.")],
    body: WeekNoteRequest,
    actor: Actor = Depends(current_actor),
    service: TimeLogService = Depends(get_timelog_service),
) -> Response:
    await service.set_note(actor, week_start, body.note)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/time/teams",
    operation_id="listTimeTeams",
    summary="Teams whose time page I may open: the teams I lead (all, for an admin)",
    response_model=TimeTeamList,
    openapi_extra=roles("member"),
)
async def list_time_teams(
    actor: Actor = Depends(current_actor),
    service: TimeLogService = Depends(get_timelog_service),
) -> TimeTeamList:
    return await service.teams_for(actor)


@router.get(
    "/teams/{teamId}/time",
    operation_id="getTeamTime",
    summary="A team's week: each member's hours, target, note and work on this team's cards "
    "(the team's leads and admins; D-116)",
    response_model=TeamWeek,
    openapi_extra=roles("member"),
)
async def get_team_time(
    team_id: Annotated[Id, Path(alias="teamId")],
    week: Week = None,
    month: Month = None,
    actor: Actor = Depends(current_actor),
    service: TimeLogService = Depends(get_timelog_service),
) -> TeamWeek:
    return await service.team_week(actor, team_id, week, month)


@router.get(
    "/teams/{teamId}/time.csv",
    operation_id="getTeamTimeExport",
    summary="A team's week or month as CSV - every entry on its cards and each member's totals "
    "(the team's leads and admins; D-140)",
    response_class=Response,
    responses={
        200: {"description": "The CSV.", "content": {"text/csv": {"schema": {"type": "string"}}}},
        403: {"description": "Not a lead of this team."},
    },
    openapi_extra=roles("member"),
)
async def get_team_time_export(
    team_id: Annotated[Id, Path(alias="teamId")],
    week: Week = None,
    month: Month = None,
    actor: Actor = Depends(current_actor),
    service: TimeLogService = Depends(get_timelog_service),
) -> Response:
    csv = await service.team_csv(actor, team_id, week, month)
    return Response(
        content=csv.body,
        media_type="text/csv; charset=utf-8",
        headers={"content-disposition": f'attachment; filename="{csv.filename}"'},
    )
