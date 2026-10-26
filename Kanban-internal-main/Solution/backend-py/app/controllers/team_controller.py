"""teams: list, detail, create, update, delete, membership, leads, history."""

from typing import Annotated

from fastapi import APIRouter, Body, Depends, Path, Query, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_team_service
from app.schemas.common_schema import Id, problem_responses
from app.schemas.org_schema import (
    CreateTeamRequest,
    OrgEventPage,
    RemovalResult,
    RemoveMemberRequest,
    SetLeadRequest,
    TeamDetail,
    TeamList,
    UpdateTeamRequest,
)
from app.services.team_service import TeamService

router = APIRouter(prefix="/teams", tags=["teams"], route_class=RoleRoute)

TeamId = Annotated[Id, Path(alias="id")]
UserId = Annotated[Id, Path(alias="userId")]
Offset = Annotated[int, Query(ge=0)]
Limit = Annotated[int, Query(ge=1, le=100)]
# The body is optional: without it every open card of the person is released.
_NO_REASSIGNMENTS = RemoveMemberRequest()


@router.get(
    "",
    operation_id="listTeams",
    summary="All teams, with my membership and member counts",
    response_model=TeamList,
    openapi_extra=roles("member"),
)
async def list_teams(
    actor: Actor = Depends(current_actor), service: TeamService = Depends(get_team_service)
) -> TeamList:
    return await service.list_all(actor)


@router.post(
    "",
    operation_id="createTeam",
    summary="Create a team",
    status_code=status.HTTP_201_CREATED,
    response_model=TeamDetail,
    response_model_exclude_unset=True,
    responses=problem_responses(422),
    openapi_extra=roles("admin"),
)
async def create_team(
    body: CreateTeamRequest,
    actor: Actor = Depends(current_actor),
    service: TeamService = Depends(get_team_service),
) -> TeamDetail:
    return await service.create(actor, body)


@router.get(
    "/{id}",
    operation_id="getTeam",
    summary="A team with its members",
    response_model=TeamDetail,
    response_model_exclude_unset=True,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def get_team(
    team_id: TeamId,
    actor: Actor = Depends(current_actor),
    service: TeamService = Depends(get_team_service),
) -> TeamDetail:
    return await service.get(actor, team_id)


@router.patch(
    "/{id}",
    operation_id="updateTeam",
    summary="Rename, describe, or set the Teams webhook (admin or a lead of the team, CR-11)",
    response_model=TeamDetail,
    response_model_exclude_unset=True,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def update_team(
    team_id: TeamId,
    body: UpdateTeamRequest,
    actor: Actor = Depends(current_actor),
    service: TeamService = Depends(get_team_service),
) -> TeamDetail:
    return await service.update(actor, team_id, body)


@router.delete(
    "/{id}",
    operation_id="deleteTeam",
    summary="Delete an empty team (D-032)",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(404, 409),
    openapi_extra=roles("admin"),
)
async def delete_team(
    team_id: TeamId,
    actor: Actor = Depends(current_actor),
    service: TeamService = Depends(get_team_service),
) -> Response:
    await service.delete(actor, team_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{id}/members/{userId}",
    operation_id="addTeamMember",
    summary="Add an active person to the team (admin or a lead of the team)",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def add_team_member(
    team_id: TeamId,
    user_id: UserId,
    actor: Actor = Depends(current_actor),
    service: TeamService = Depends(get_team_service),
) -> Response:
    await service.add_member(actor, team_id, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/{id}/members/{userId}",
    operation_id="setTeamMemberLead",
    summary="Make a member a team lead, or not (CR-11)",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(404, 422),
    openapi_extra=roles("admin"),
)
async def set_team_member_lead(
    team_id: TeamId,
    user_id: UserId,
    body: SetLeadRequest,
    actor: Actor = Depends(current_actor),
    service: TeamService = Depends(get_team_service),
) -> Response:
    await service.set_lead(actor, team_id, user_id, body.is_lead)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{id}/members/{userId}/removal",
    operation_id="removeTeamMember",
    summary="Remove a member; their open cards in the team are reassigned or released (D-050)",
    response_model=RemovalResult,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def remove_team_member(
    team_id: TeamId,
    user_id: UserId,
    body: Annotated[RemoveMemberRequest, Body()] = _NO_REASSIGNMENTS,
    actor: Actor = Depends(current_actor),
    service: TeamService = Depends(get_team_service),
) -> RemovalResult:
    return await service.remove_member(actor, team_id, user_id, body)


@router.get(
    "/{id}/events",
    operation_id="listTeamEvents",
    summary="The team's history, newest first",
    response_model=OrgEventPage,
    response_model_exclude_unset=True,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def list_team_events(
    team_id: TeamId,
    offset: Offset = 0,
    limit: Limit = 25,
    service: TeamService = Depends(get_team_service),
) -> OrgEventPage:
    return await service.events_page(team_id, offset, limit)
