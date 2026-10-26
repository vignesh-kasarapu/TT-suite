"""Administration > Email templates (D-141): admins edit each email's subject and text."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_mail_template_service
from app.schemas.common_schema import problem_responses
from app.schemas.mail_template_schema import (
    MailKind,
    MailPreview,
    MailTemplateBody,
    MailTemplateList,
)
from app.services.mail_template_service import MailTemplateService

router = APIRouter(prefix="/admin/mail-templates", tags=["admin"], route_class=RoleRoute)
Kind = Annotated[MailKind, Path()]


@router.get(
    "",
    operation_id="listMailTemplates",
    summary="Every email's wording: what it says now, the built-in default and its placeholders",
    response_model=MailTemplateList,
    openapi_extra=roles("admin"),
)
async def list_mail_templates(
    service: MailTemplateService = Depends(get_mail_template_service),
) -> MailTemplateList:
    return await service.list_all()


@router.put(
    "/{kind}",
    operation_id="saveMailTemplate",
    summary="Save an email's subject and text; unknown {placeholders} are refused",
    response_model=MailTemplateList,
    responses=problem_responses(422),
    openapi_extra=roles("admin"),
)
async def save_mail_template(
    kind: Kind,
    body: MailTemplateBody,
    actor: Actor = Depends(current_actor),
    service: MailTemplateService = Depends(get_mail_template_service),
) -> MailTemplateList:
    return await service.save(actor, kind, body)


@router.delete(
    "/{kind}",
    operation_id="resetMailTemplate",
    summary="Back to the built-in wording for this email",
    response_model=MailTemplateList,
    openapi_extra=roles("admin"),
)
async def reset_mail_template(
    kind: Kind, service: MailTemplateService = Depends(get_mail_template_service)
) -> MailTemplateList:
    return await service.reset(kind)


@router.post(
    "/{kind}/preview",
    operation_id="previewMailTemplate",
    summary="The email as it would look, filled with sample values (nothing is saved or sent)",
    response_model=MailPreview,
    responses=problem_responses(422),
    openapi_extra=roles("admin"),
)
async def preview_mail_template(
    kind: Kind,
    body: MailTemplateBody,
    service: MailTemplateService = Depends(get_mail_template_service),
) -> MailPreview:
    return service.preview(kind, body)
