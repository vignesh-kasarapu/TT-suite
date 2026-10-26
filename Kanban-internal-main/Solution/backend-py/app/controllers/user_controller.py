"""users: the picker list, admission (D-083), admin grant/revoke (FR-004), directory search,
pictures."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_profile_service, get_user_service
from app.schemas.auth_schema import UserRef
from app.schemas.common_schema import Id, problem_responses
from app.schemas.org_schema import DirectoryHits, InviteUserRequest, UpdateUserRequest, UserList
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


@router.post(
    "",
    operation_id="inviteUser",
    summary="Invite a person: at least one team, optional default project; email queued (D-083)",
    status_code=status.HTTP_201_CREATED,
    response_model=UserRef,
    responses=problem_responses(422),
    openapi_extra=roles("admin"),
)
async def invite_user(
    body: InviteUserRequest,
    actor: Actor = Depends(current_actor),
    service: UserService = Depends(get_user_service),
) -> UserRef:
    return await service.invite(actor, body)


@router.get(
    "/directory",
    operation_id="searchDirectory",
    summary="Search the Entra directory for the invite form (D-084)",
    response_model=DirectoryHits,
    responses=problem_responses(404, 502),
    openapi_extra=roles("admin"),
)
async def search_directory(
    q: Annotated[str, Query(min_length=2, max_length=80)],
    service: UserService = Depends(get_user_service),
) -> DirectoryHits:
    return await service.search_directory(q)


@router.patch(
    "/{id}",
    operation_id="updateUser",
    summary="Grant/revoke admin, deactivate or reactivate a person (never yourself)",
    response_model=UserRef,
    responses=problem_responses(404, 422),
    openapi_extra=roles("admin"),
)
async def update_user(
    user_id: UserId,
    body: UpdateUserRequest,
    actor: Actor = Depends(current_actor),
    service: UserService = Depends(get_user_service),
) -> UserRef:
    return await service.update(actor, user_id, body)


@router.post(
    "/{id}/invite",
    operation_id="resendInvitation",
    summary="Queue the invitation email again for an invited person",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(404, 422),
    openapi_extra=roles("admin"),
)
async def resend_invitation(
    user_id: UserId,
    actor: Actor = Depends(current_actor),
    service: UserService = Depends(get_user_service),
) -> Response:
    await service.resend_invitation(actor, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
