"""tags: the vocabulary cards may use (D-062)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_tag_service
from app.schemas.common_schema import Id, problem_responses
from app.schemas.org_schema import Tag, TagList, TagNameRequest
from app.services.tag_service import TagService

router = APIRouter(prefix="/tags", tags=["tags"], route_class=RoleRoute)

TagId = Annotated[Id, Path(alias="id")]


@router.get(
    "",
    operation_id="listTags",
    summary="All tags with how many cards carry each",
    response_model=TagList,
    openapi_extra=roles("member"),
)
async def list_tags(service: TagService = Depends(get_tag_service)) -> TagList:
    return await service.list_all()


@router.post(
    "",
    operation_id="createTag",
    summary="Add a tag",
    status_code=status.HTTP_201_CREATED,
    response_model=Tag,
    responses=problem_responses(422),
    openapi_extra=roles("admin"),
)
async def create_tag(
    body: TagNameRequest,
    actor: Actor = Depends(current_actor),
    service: TagService = Depends(get_tag_service),
) -> Tag:
    return await service.create(actor, body.name)


@router.patch(
    "/{id}",
    operation_id="renameTag",
    summary="Rename a tag; every card carrying it follows",
    response_model=Tag,
    responses=problem_responses(404, 422),
    openapi_extra=roles("admin"),
)
async def rename_tag(
    tag_id: TagId,
    body: TagNameRequest,
    actor: Actor = Depends(current_actor),
    service: TagService = Depends(get_tag_service),
) -> Tag:
    return await service.rename(actor, tag_id, body.name)


@router.delete(
    "/{id}",
    operation_id="deleteTag",
    summary="Delete a tag no card uses",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(404, 409),
    openapi_extra=roles("admin"),
)
async def delete_tag(
    tag_id: TagId,
    actor: Actor = Depends(current_actor),
    service: TagService = Depends(get_tag_service),
) -> Response:
    await service.delete(actor, tag_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
