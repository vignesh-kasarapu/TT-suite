"""boards and cards: the four boards, search, create, read, update, move, copy, history."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_card_service
from app.schemas.card_schema import (
    Board,
    Card,
    CardCopyRequest,
    CardCreateRequest,
    CardEventPage,
    CardKey,
    CardPatchRequest,
    CardSearchPage,
    CardState,
    MoveRequest,
    Plane,
)
from app.schemas.common_schema import Id, problem_responses
from app.services.card_service import BoardQuery, CardService, SearchQuery

boards = APIRouter(prefix="/boards", tags=["boards"], route_class=RoleRoute)
cards = APIRouter(prefix="/cards", tags=["cards"], route_class=RoleRoute)

Key = Annotated[CardKey, Path()]
IncludeClosed = Annotated[bool, Query(alias="includeClosed")]
Tag = Annotated[str | None, Query(max_length=40)]
Prio = Annotated[int | None, Query(ge=1, le=4)]
Text = Annotated[str | None, Query(max_length=100)]
ProjectId = Annotated[Id | None, Query(alias="projectId")]
ProgramId = Annotated[
    Id | None, Query(alias="programId", description="Cards whose project is in this program.")
]
AssigneeId = Annotated[Id | None, Query(alias="assigneeId")]
Offset = Annotated[int, Query(ge=0)]
Limit = Annotated[int, Query(ge=1, le=100)]


# ---- boards (server order: priority, ETA with none last, created; closed cards 14 days)
@boards.get(
    "/private",
    operation_id="getPrivateBoard",
    summary="The caller's private board - every open card grouped by state, in board order",
    response_model=Board,
    responses=problem_responses(401),
    openapi_extra=roles("member"),
)
async def get_private_board(
    include_closed: IncludeClosed = False,
    tag: Tag = None,
    priority: Prio = None,
    q: Text = None,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Board:
    query = BoardQuery(include_closed=include_closed, tag=tag, priority=priority, q=q)
    return await service.board(actor, "private", query)


@boards.get(
    "/teams/{teamId}",
    operation_id="getTeamBoard",
    summary="A team's board (members and admins; others get 403 OTHER_TEAM, CR-14/28)",
    response_model=Board,
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
)
async def get_team_board(
    team_id: Annotated[Id, Path(alias="teamId")],
    include_closed: IncludeClosed = False,
    project_id: ProjectId = None,
    program_id: ProgramId = None,
    assignee_id: AssigneeId = None,
    tag: Tag = None,
    priority: Prio = None,
    q: Text = None,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Board:
    query = BoardQuery(
        include_closed=include_closed,
        tag=tag,
        priority=priority,
        q=q,
        project_id=project_id,
        program_id=program_id,
        assignee_id=assignee_id,
    )
    return await service.board(actor, "team", query, team_id)


@boards.get(
    "/my-org",
    operation_id="getMyOrgBoard",
    summary="Every org card of my teams, plus any assigned to me; admins: every org card (D-130)",
    response_model=Board,
    openapi_extra=roles("member"),
)
async def get_my_org_board(
    include_closed: IncludeClosed = False,
    project_id: ProjectId = None,
    program_id: ProgramId = None,
    tag: Tag = None,
    priority: Prio = None,
    q: Text = None,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Board:
    query = BoardQuery(
        include_closed=include_closed,
        tag=tag,
        priority=priority,
        q=q,
        project_id=project_id,
        program_id=program_id,
    )
    return await service.board(actor, "mine", query)


@boards.get(
    "/unassigned",
    operation_id="getUnassignedBoard",
    summary="Org cards nobody is assigned to, to be claimed (D-122); mode=no_team: those "
    "without a team",
    response_model=Board,
    openapi_extra=roles("member"),
)
async def get_unassigned_board(
    mode: Annotated[Literal["all", "no_team"], Query()] = "all",
    include_closed: IncludeClosed = False,
    assignee_id: AssigneeId = None,
    tag: Tag = None,
    priority: Prio = None,
    q: Text = None,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Board:
    query = BoardQuery(
        include_closed=include_closed, tag=tag, priority=priority, q=q, assignee_id=assignee_id
    )
    return await service.board(actor, "no_team" if mode == "no_team" else "unassigned", query)


# ---- cards
@cards.get(
    "",
    operation_id="searchCards",
    summary="Search key, title and tags across what I may read; filters combine (FR-056)",
    response_model=CardSearchPage,
    openapi_extra=roles("member"),
)
async def search_cards(
    q: Text = None,
    plane: Annotated[Plane | None, Query()] = None,
    team_id: Annotated[Id | None, Query(alias="teamId")] = None,
    project_id: ProjectId = None,
    program_id: Annotated[Id | None, Query(alias="programId")] = None,
    assignee_id: AssigneeId = None,
    state: Annotated[CardState | None, Query()] = None,
    tag: Tag = None,
    priority: Prio = None,
    include_closed: IncludeClosed = True,
    offset: Offset = 0,
    limit: Limit = 25,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> CardSearchPage:
    query = SearchQuery(
        text=q or "",
        include_closed=include_closed,
        plane=plane,
        team_id=team_id,
        project_id=project_id,
        program_id=program_id,
        assignee_id=assignee_id,
        state=state,
        tag=tag,
        priority=priority,
    )
    return await service.search(actor, query, offset, limit)


@cards.post(
    "",
    operation_id="createCard",
    summary="Create a card; an org card always gets a team (CR-22)",
    status_code=status.HTTP_201_CREATED,
    response_model=Card,
    responses=problem_responses(422),
    openapi_extra=roles("member"),
)
async def create_card(
    body: CardCreateRequest,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Card:
    return await service.create(actor, body)


@cards.get(
    "/{key}",
    operation_id="getCard",
    summary="A card",
    response_model=Card,
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
)
async def get_card(
    key: Key,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Card:
    return await service.get(actor, key)


@cards.patch(
    "/{key}",
    operation_id="updateCard",
    summary="Change a card; every changed field is an event (one group), version + 1",
    response_model=Card,
    responses=problem_responses(403, 404, 409, 422),
    openapi_extra=roles("member"),
)
async def update_card(
    key: Key,
    body: CardPatchRequest,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Card:
    return await service.update(actor, key, body)


@cards.post(
    "/{key}/move",
    operation_id="moveCard",
    summary="Move a card to another state",
    response_model=Card,
    responses=problem_responses(403, 404, 409),
    openapi_extra=roles("member"),
)
async def move_card(
    key: Key,
    body: MoveRequest,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Card:
    return await service.move(actor, key, body.state, body.version)


@cards.post(
    "/{key}/copies",
    operation_id="copyCard",
    summary="Copy a card to the other plane, linked, with chosen comments/events (D-056)",
    status_code=status.HTTP_201_CREATED,
    response_model=Card,
    responses=problem_responses(403, 404, 409, 422),
    openapi_extra=roles("member"),
)
async def copy_card(
    key: Key,
    body: CardCopyRequest,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> Card:
    return await service.copy(actor, key, body)


@cards.get(
    "/{key}/events",
    operation_id="listCardEvents",
    summary="The card's history, newest first",
    response_model=CardEventPage,
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
)
async def list_card_events(
    key: Key,
    field: Annotated[str | None, Query(max_length=40)] = None,
    offset: Offset = 0,
    limit: Limit = 25,
    actor: Actor = Depends(current_actor),
    service: CardService = Depends(get_card_service),
) -> CardEventPage:
    return await service.events_page(actor, key, field, offset, limit)
