"""users: the picker list, role-change requests to the global admin (TT Suite), pictures.
Accounts and roles are the portal's (the global admin); see /internal/provision."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_profile_service, get_user_service
from app.schemas.common_schema import Id, problem_responses
from app.schemas.org_schema import (
    RoleChangeRequest,
    RoleRequestCreated,
    RoleRequestList,
    UserList,
)
from app.services.profile_service import ProfileService
from app.services.user_service import UserService
from app.utils.time import http_date

router = APIRouter(prefix="/users", tags=["users"], route_class=RoleRoute)

UserId = Annotated[Id, Path(alias="id")]
_IMAGE = {"schema": {"type": "string", "format": "binary"}}


@router.get(
    "",
    operation_id="listUsers",
    summary="People for pickers; admins may ask for everyone, invited and inactive included",
    response_model=UserList,
    openapi_extra=roles("member"),
)
async def list_users(
    status_filter: Annotated[Literal["active", "all"] | None, Query(alias="status")] = None,
    actor: Actor = Depends(current_actor),
    service: UserService = Depends(get_user_service),
) -> UserList:
    return await service.list_all(actor, status_filter)


@router.get(
    "/role-requests",
    operation_id="listRoleRequests",
    summary="Open role-change requests for Kanban, waiting for the global admin",
    response_model=RoleRequestList,
    openapi_extra=roles("admin"),
)
async def list_role_requests(service: UserService = Depends(get_user_service)) -> RoleRequestList:
    return await service.role_requests()


@router.post(
    "/{id}/role-request",
    operation_id="requestRoleChange",
    summary="Ask the global admin to change a person's Kanban role (only they assign roles)",
    status_code=status.HTTP_201_CREATED,
    response_model=RoleRequestCreated,
    responses=problem_responses(404, 422),
    openapi_extra=roles("admin"),
)
async def request_role_change(
    user_id: UserId,
    body: RoleChangeRequest,
    actor: Actor = Depends(current_actor),
    service: UserService = Depends(get_user_service),
) -> RoleRequestCreated:
    return await service.request_role(actor, user_id, body)


@router.get(
    "/{id}/photo",
    operation_id="getUserPhoto",
    summary="A user's picture (any member may see it); 404 when none",
    response_class=Response,
    responses={
        200: {
            "description": "The image bytes; Cache-Control: private, max-age=86400.",
            "content": {"image/jpeg": _IMAGE, "image/png": _IMAGE, "image/webp": _IMAGE},
        },
        **problem_responses(404),
    },
    openapi_extra=roles("member"),
)
async def get_user_photo(
    user_id: UserId,
    service: ProfileService = Depends(get_profile_service),
) -> Response:
    photo = await service.photo_of(user_id)
    return Response(
        content=photo.photo,
        media_type=photo.photo_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "Last-Modified": http_date(photo.photo_updated_at),
        },
    )
