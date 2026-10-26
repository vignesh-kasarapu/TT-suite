"""programs and projects: CRUD, closure (CR-12), history."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_link_service, get_program_service, get_project_service
from app.schemas.card_schema import DependencyTree
from app.schemas.common_schema import Id, problem_responses
from app.schemas.org_schema import (
    CloseProjectRequest,
    CreateProgramRequest,
    CreateProjectRequest,
    OrgEventPage,
    ProgramDetail,
    ProgramList,
    Project,
    ProjectList,
    UpdateProgramRequest,
    UpdateProjectRequest,
)
from app.services.link_service import LinkService
from app.services.program_service import ProgramService, ProjectService

programs = APIRouter(prefix="/programs", tags=["programs"], route_class=RoleRoute)
projects = APIRouter(prefix="/projects", tags=["projects"], route_class=RoleRoute)

EntityId = Annotated[Id, Path(alias="id")]
Offset = Annotated[int, Query(ge=0)]
Limit = Annotated[int, Query(ge=1, le=100)]


# ---- programs
@programs.get(
    "",
    operation_id="listPrograms",
    summary="All programs with project counts and derived dates",
    response_model=ProgramList,
    openapi_extra=roles("member"),
)
async def list_programs(service: ProgramService = Depends(get_program_service)) -> ProgramList:
    return await service.list_all()


@programs.post(
    "",
    operation_id="createProgram",
    summary="Create a program",
    status_code=status.HTTP_201_CREATED,
    response_model=ProgramDetail,
    response_model_exclude_unset=True,
    responses=problem_responses(422),
    openapi_extra=roles("admin"),
)
async def create_program(
    body: CreateProgramRequest,
    actor: Actor = Depends(current_actor),
    service: ProgramService = Depends(get_program_service),
) -> ProgramDetail:
    return await service.create(actor, body)


@programs.get(
    "/{id}",
    operation_id="getProgram",
    summary="A program with its projects",
    response_model=ProgramDetail,
    response_model_exclude_unset=True,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def get_program(
    program_id: EntityId, service: ProgramService = Depends(get_program_service)
) -> ProgramDetail:
    return await service.get(program_id)


@programs.patch(
    "/{id}",
    operation_id="updateProgram",
    summary="Rename, describe or re-date a program (CR-26 date rules)",
    response_model=ProgramDetail,
    response_model_exclude_unset=True,
    responses=problem_responses(404, 422),
    openapi_extra=roles("admin"),
)
async def update_program(
    program_id: EntityId,
    body: UpdateProgramRequest,
    actor: Actor = Depends(current_actor),
    service: ProgramService = Depends(get_program_service),
) -> ProgramDetail:
    return await service.update(actor, program_id, body)


@programs.delete(
    "/{id}",
    operation_id="deleteProgram",
    summary="Delete a program with no projects (D-032)",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(404, 409),
    openapi_extra=roles("admin"),
)
async def delete_program(
    program_id: EntityId,
    actor: Actor = Depends(current_actor),
    service: ProgramService = Depends(get_program_service),
) -> Response:
    await service.delete(actor, program_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@programs.get(
    "/{id}/events",
    operation_id="listProgramEvents",
    summary="The program's history, newest first",
    response_model=OrgEventPage,
    response_model_exclude_unset=True,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def list_program_events(
    program_id: EntityId,
    offset: Offset = 0,
    limit: Limit = 25,
    service: ProgramService = Depends(get_program_service),
) -> OrgEventPage:
    return await service.events_page(program_id, offset, limit)


# ---- projects
@projects.get(
    "",
    operation_id="listProjects",
    summary="Projects, optionally by team or program; closed ones only on request (CR-12)",
    response_model=ProjectList,
    response_model_exclude_unset=True,
    openapi_extra=roles("member"),
)
async def list_projects(
    team_id: Annotated[Id | None, Query(alias="teamId")] = None,
    program_id: Annotated[Id | None, Query(alias="programId")] = None,
    include_closed: Annotated[bool, Query(alias="includeClosed")] = False,
    service: ProjectService = Depends(get_project_service),
) -> ProjectList:
    return await service.list_all(
        team_id=team_id, program_id=program_id, include_closed=include_closed
    )


@projects.post(
    "",
    operation_id="createProject",
    summary="Create a project in a team (admin or a lead of the team)",
    status_code=status.HTTP_201_CREATED,
    response_model=Project,
    response_model_exclude_unset=True,
    responses=problem_responses(403, 422),
    openapi_extra=roles("member"),
)
async def create_project(
    body: CreateProjectRequest,
    actor: Actor = Depends(current_actor),
    service: ProjectService = Depends(get_project_service),
) -> Project:
    return await service.create(actor, body)


@projects.get(
    "/{id}",
    operation_id="getProject",
    summary="A project",
    response_model=Project,
    response_model_exclude_unset=True,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def get_project(
    project_id: EntityId, service: ProjectService = Depends(get_project_service)
) -> Project:
    return await service.get(project_id)


@projects.patch(
    "/{id}",
    operation_id="updateProject",
    summary="Change a project; re-teaming moves its cards with it (D-046)",
    response_model=Project,
    response_model_exclude_unset=True,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def update_project(
    project_id: EntityId,
    body: UpdateProjectRequest,
    actor: Actor = Depends(current_actor),
    service: ProjectService = Depends(get_project_service),
) -> Project:
    return await service.update(actor, project_id, body)


@projects.delete(
    "/{id}",
    operation_id="deleteProject",
    summary="Delete a project with no cards (D-032)",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(403, 404, 409),
    openapi_extra=roles("member"),
)
async def delete_project(
    project_id: EntityId,
    actor: Actor = Depends(current_actor),
    service: ProjectService = Depends(get_project_service),
) -> Response:
    await service.delete(actor, project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@projects.get(
    "/{id}/events",
    operation_id="listProjectEvents",
    summary="The project's history, newest first",
    response_model=OrgEventPage,
    response_model_exclude_unset=True,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def list_project_events(
    project_id: EntityId,
    offset: Offset = 0,
    limit: Limit = 25,
    service: ProjectService = Depends(get_project_service),
) -> OrgEventPage:
    return await service.events_page(project_id, offset, limit)


@projects.post(
    "/{id}/closure",
    operation_id="closeProject",
    summary="Close a project, closing every open card in the same call (CR-12)",
    response_model=Project,
    response_model_exclude_unset=True,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("admin"),
)
async def close_project(
    project_id: EntityId,
    body: CloseProjectRequest,
    actor: Actor = Depends(current_actor),
    service: ProjectService = Depends(get_project_service),
) -> Project:
    return await service.close(actor, project_id, body)


@projects.delete(
    "/{id}/closure",
    operation_id="reopenProject",
    summary="Reopen a closed project",
    response_model=Project,
    response_model_exclude_unset=True,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("admin"),
)
async def reopen_project(
    project_id: EntityId,
    actor: Actor = Depends(current_actor),
    service: ProjectService = Depends(get_project_service),
) -> Project:
    return await service.reopen(actor, project_id)


# ---- dependency trees (FR-033)
@programs.get(
    "/{id}/tree",
    operation_id="getProgramTree",
    summary="Dependency tree of a program's cards: nodes, edges, cycles",
    response_model=DependencyTree,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def get_program_tree(
    program_id: EntityId,
    actor: Actor = Depends(current_actor),
    service: LinkService = Depends(get_link_service),
) -> DependencyTree:
    return await service.program_tree(actor, program_id)


@projects.get(
    "/{id}/tree",
    operation_id="getProjectTree",
    summary="Dependency tree of a project's cards: nodes, edges, cycles",
    response_model=DependencyTree,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def get_project_tree(
    project_id: EntityId,
    actor: Actor = Depends(current_actor),
    service: LinkService = Depends(get_link_service),
) -> DependencyTree:
    return await service.project_tree(actor, project_id)
