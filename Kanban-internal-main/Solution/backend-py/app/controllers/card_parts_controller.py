"""comments, links, time entries and attachments of a card; project documents."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Response, status

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import (
    get_attachment_service,
    get_comment_service,
    get_link_service,
    get_time_service,
)
from app.schemas.card_schema import (
    Attachment,
    AttachmentCreate,
    AttachmentList,
    CardKey,
    CardLink,
    CardLinkList,
    Comment,
    CommentBody,
    CommentList,
    LinkCreateRequest,
    ProjectDocuments,
    TimeEntry,
    TimeEntryBody,
    TimeEntryList,
    VoteRequest,
)
from app.schemas.common_schema import Id, problem_responses
from app.services.attachment_service import AttachmentService
from app.services.comment_service import CommentService
from app.services.link_service import LinkService
from app.services.time_service import TimeService

comments = APIRouter(prefix="/cards/{key}/comments", tags=["comments"], route_class=RoleRoute)
links = APIRouter(prefix="/cards/{key}/links", tags=["links"], route_class=RoleRoute)
time = APIRouter(prefix="/cards/{key}/time", tags=["time"], route_class=RoleRoute)
attachments = APIRouter(tags=["attachments"], route_class=RoleRoute)

Key = Annotated[CardKey, Path()]
CommentId = Annotated[Id, Path(alias="commentId")]
NO_CONTENT = {"status_code": status.HTTP_204_NO_CONTENT, "response_class": Response}


# ---- comments
@comments.get(
    "",
    operation_id="listComments",
    summary="Comments with votes, oldest first",
    response_model=CommentList,
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
)
async def list_comments(
    key: Key,
    actor: Actor = Depends(current_actor),
    service: CommentService = Depends(get_comment_service),
) -> CommentList:
    return await service.list_for(actor, key)


@comments.post(
    "",
    operation_id="addComment",
    summary="Add a comment or a reply (stays open on a closed card, CR-24)",
    status_code=status.HTTP_201_CREATED,
    response_model=Comment,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def add_comment(
    key: Key,
    body: CommentBody,
    actor: Actor = Depends(current_actor),
    service: CommentService = Depends(get_comment_service),
) -> Comment:
    return await service.add(actor, key, body.body, body.parent_id)


@comments.put(
    "/{commentId}/vote",
    operation_id="voteComment",
    summary="Vote a comment up, down, or clear my vote",
    response_model=Comment,
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
)
async def vote_comment(
    key: Key,
    comment_id: CommentId,
    body: VoteRequest,
    actor: Actor = Depends(current_actor),
    service: CommentService = Depends(get_comment_service),
) -> Comment:
    return await service.vote(actor, key, comment_id, body.value)


@comments.patch(
    "/{commentId}",
    operation_id="editComment",
    summary="Edit my comment",
    response_model=Comment,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def edit_comment(
    key: Key,
    comment_id: CommentId,
    body: CommentBody,
    actor: Actor = Depends(current_actor),
    service: CommentService = Depends(get_comment_service),
) -> Comment:
    return await service.edit(actor, key, comment_id, body.body)


@comments.delete(
    "/{commentId}",
    operation_id="deleteComment",
    summary="Delete my comment (not while it has replies)",
    responses=problem_responses(403, 404, 409),
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def delete_comment(
    key: Key,
    comment_id: CommentId,
    actor: Actor = Depends(current_actor),
    service: CommentService = Depends(get_comment_service),
) -> Response:
    await service.delete(actor, key, comment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- links
@links.get(
    "",
    operation_id="listCardLinks",
    summary="Links of a card (ends I may not read are left out)",
    response_model=CardLinkList,
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
)
async def list_card_links(
    key: Key,
    actor: Actor = Depends(current_actor),
    service: LinkService = Depends(get_link_service),
) -> CardLinkList:
    return await service.list_for(actor, key)


@links.post(
    "",
    operation_id="addCardLink",
    summary="Link this card to another (write here, read there); duplicates refused",
    status_code=status.HTTP_201_CREATED,
    response_model=CardLink,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def add_card_link(
    key: Key,
    body: LinkCreateRequest,
    actor: Actor = Depends(current_actor),
    service: LinkService = Depends(get_link_service),
) -> CardLink:
    return await service.add(actor, key, body.type, body.target_key)


@links.delete(
    "/{linkId}",
    operation_id="removeCardLink",
    summary="Remove a link",
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def remove_card_link(
    key: Key,
    link_id: Annotated[Id, Path(alias="linkId")],
    actor: Actor = Depends(current_actor),
    service: LinkService = Depends(get_link_service),
) -> Response:
    await service.remove(actor, key, link_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- time entries
@time.get(
    "",
    operation_id="listTimeEntries",
    summary="Time entries: everyone's for admins and team leads, else my own (CR-13)",
    response_model=TimeEntryList,
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
)
async def list_time_entries(
    key: Key,
    actor: Actor = Depends(current_actor),
    service: TimeService = Depends(get_time_service),
) -> TimeEntryList:
    return await service.list_for(actor, key)


@time.post(
    "",
    operation_id="addTimeEntry",
    summary="Log time on a card (at most 24 h per person per date, CR-21)",
    status_code=status.HTTP_201_CREATED,
    response_model=TimeEntry,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def add_time_entry(
    key: Key,
    body: TimeEntryBody,
    actor: Actor = Depends(current_actor),
    service: TimeService = Depends(get_time_service),
) -> TimeEntry:
    return await service.add(actor, key, body)


@time.patch(
    "/{entryId}",
    operation_id="editTimeEntry",
    summary="Edit my time entry",
    response_model=TimeEntry,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def edit_time_entry(
    key: Key,
    entry_id: Annotated[Id, Path(alias="entryId")],
    body: TimeEntryBody,
    actor: Actor = Depends(current_actor),
    service: TimeService = Depends(get_time_service),
) -> TimeEntry:
    return await service.edit(actor, key, entry_id, body)


@time.delete(
    "/{entryId}",
    operation_id="deleteTimeEntry",
    summary="Delete my time entry",
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def delete_time_entry(
    key: Key,
    entry_id: Annotated[Id, Path(alias="entryId")],
    actor: Actor = Depends(current_actor),
    service: TimeService = Depends(get_time_service),
) -> Response:
    await service.delete(actor, key, entry_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---- attachments
@attachments.get(
    "/cards/{key}/attachments",
    operation_id="listCardAttachments",
    summary="Attachments of a card, newest first",
    response_model=AttachmentList,
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
)
async def list_card_attachments(
    key: Key,
    actor: Actor = Depends(current_actor),
    service: AttachmentService = Depends(get_attachment_service),
) -> AttachmentList:
    return await service.list_for_card(actor, key)


@attachments.post(
    "/cards/{key}/attachments",
    operation_id="addCardAttachment",
    summary="Attach a link to a card",
    status_code=status.HTTP_201_CREATED,
    response_model=Attachment,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def add_card_attachment(
    key: Key,
    body: AttachmentCreate,
    actor: Actor = Depends(current_actor),
    service: AttachmentService = Depends(get_attachment_service),
) -> Attachment:
    return await service.add_to_card(actor, key, body)


@attachments.delete(
    "/cards/{key}/attachments/{attachmentId}",
    operation_id="removeCardAttachment",
    summary="Remove a card attachment",
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def remove_card_attachment(
    key: Key,
    attachment_id: Annotated[Id, Path(alias="attachmentId")],
    actor: Actor = Depends(current_actor),
    service: AttachmentService = Depends(get_attachment_service),
) -> Response:
    await service.remove_from_card(actor, key, attachment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@attachments.post(
    "/projects/{id}/attachments",
    operation_id="addProjectAttachment",
    summary="Add a common link to a project (project team or admin)",
    status_code=status.HTTP_201_CREATED,
    response_model=Attachment,
    responses=problem_responses(403, 404, 422),
    openapi_extra=roles("member"),
)
async def add_project_attachment(
    project_id: Annotated[Id, Path(alias="id")],
    body: AttachmentCreate,
    actor: Actor = Depends(current_actor),
    service: AttachmentService = Depends(get_attachment_service),
) -> Attachment:
    return await service.add_to_project(actor, project_id, body)


@attachments.delete(
    "/projects/{id}/attachments/{attachmentId}",
    operation_id="removeProjectAttachment",
    summary="Remove a project's common link",
    responses=problem_responses(403, 404),
    openapi_extra=roles("member"),
    **NO_CONTENT,  # type: ignore[arg-type]
)
async def remove_project_attachment(
    project_id: Annotated[Id, Path(alias="id")],
    attachment_id: Annotated[Id, Path(alias="attachmentId")],
    actor: Actor = Depends(current_actor),
    service: AttachmentService = Depends(get_attachment_service),
) -> Response:
    await service.remove_from_project(actor, project_id, attachment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@attachments.get(
    "/projects/{id}/documents",
    operation_id="getProjectDocuments",
    summary="A project's common links and the attachments of its cards I may read",
    response_model=ProjectDocuments,
    responses=problem_responses(404),
    openapi_extra=roles("member"),
)
async def get_project_documents(
    project_id: Annotated[Id, Path(alias="id")],
    actor: Actor = Depends(current_actor),
    service: AttachmentService = Depends(get_attachment_service),
) -> ProjectDocuments:
    return await service.project_documents(actor, project_id)
