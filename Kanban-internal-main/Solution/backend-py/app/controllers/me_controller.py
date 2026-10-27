"""me: the current user and session, Kanban preferences and picture. The display name, theme
and sign-out are the portal's (TT Suite)."""

from fastapi import APIRouter, Depends, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import (
    get_context_service,
    get_preference_service,
    get_profile_service,
)
from app.schemas.auth_schema import UserRef
from app.schemas.common_schema import problem_responses
from app.schemas.me_schema import (
    Me,
    PhotoUpdateRequest,
    Preferences,
    PreferencesPatch,
)
from app.services.context_service import ContextService
from app.services.preference_service import PreferenceService
from app.services.profile_service import ProfileService

router = APIRouter(prefix="/me", tags=["me"], route_class=RoleRoute)


@router.get(
    "",
    operation_id="getMe",
    summary="The current user and session, rebuilt per request from the database",
    response_model=Me,
    response_model_exclude_unset=True,
    responses=problem_responses(401),
    openapi_extra=roles("member"),
)
async def get_me(
    actor: Actor = Depends(current_actor),
    service: ContextService = Depends(get_context_service),
) -> Me:
    return await service.me(actor)


@router.get(
    "/preferences",
    operation_id="getMyPreferences",
    summary="Kanban preferences (theme and accent are read-only: the suite's, set in the portal)",
    response_model=Preferences,
    openapi_extra=roles("member"),
)
async def get_my_preferences(
    actor: Actor = Depends(current_actor),
    service: PreferenceService = Depends(get_preference_service),
) -> Preferences:
    return await service.get(actor)


@router.patch(
    "/preferences",
    operation_id="updateMyPreferences",
    summary="Update Kanban preferences (mail opt-in, defaults, Org order, inbox window)",
    response_model=Preferences,
    responses=problem_responses(422),
    openapi_extra=roles("member"),
)
async def update_my_preferences(
    body: PreferencesPatch,
    actor: Actor = Depends(current_actor),
    service: PreferenceService = Depends(get_preference_service),
) -> Preferences:
    return await service.update(actor, body)


@router.put(
    "/photo",
    operation_id="setMyPhoto",
    summary="Set my picture from a data URL the SPA resized (JPEG/PNG/WebP, <= 256 KB)",
    response_model=UserRef,
    response_model_exclude_unset=True,
    responses=problem_responses(413, 422),
    openapi_extra=roles("member"),
)
async def set_my_photo(
    body: PhotoUpdateRequest,
    actor: Actor = Depends(current_actor),
    service: ProfileService = Depends(get_profile_service),
) -> UserRef:
    return await service.set_photo(actor, body.data_url)


@router.delete(
    "/photo",
    operation_id="deleteMyPhoto",
    summary="Remove my picture",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    openapi_extra=roles("member"),
)
async def delete_my_photo(
    actor: Actor = Depends(current_actor),
    service: ProfileService = Depends(get_profile_service),
) -> Response:
    await service.delete_photo(actor)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
