"""Email wording for admins (D-141): list, save, reset to the built-in words, preview."""

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import FieldError, ValidationFailedException
from app.repositories.mail_template_repository import MailTemplateRepository
from app.schemas.mail_template_schema import (
    MailPreview,
    MailTemplate,
    MailTemplateBody,
    MailTemplateList,
)
from app.services.mail_html import html_custom
from app.services.mail_templates import (
    KINDS,
    SAMPLE,
    render_html,
    render_text,
    unknown_placeholders,
)


class MailTemplateService:
    def __init__(self, uow: UnitOfWork, templates: MailTemplateRepository, clock: Clock) -> None:
        self.uow = uow
        self.templates = templates
        self.clock = clock

    async def list_all(self) -> MailTemplateList:
        saved = await self.templates.all()
        items = []
        for kind, k in KINDS.items():
            row = saved.get(kind)
            items.append(
                MailTemplate.model_validate(
                    {
                        "kind": kind,
                        "label": k.label,
                        "placeholders": list(k.placeholders),
                        "subject": row.subject if row else k.subject,
                        "body": row.body if row else k.body,
                        "defaultSubject": k.subject,
                        "defaultBody": k.body,
                        "edited": row is not None,
                        "updatedAt": row.updated_at if row else None,
                    }
                )
            )
        return MailTemplateList(items=items)

    def _check(self, kind: str, body: MailTemplateBody) -> None:
        unknown = unknown_placeholders(kind, body.subject, body.body)
        if unknown:
            allowed = ", ".join("{" + p + "}" for p in KINDS[kind].placeholders)
            raise ValidationFailedException(
                "Unknown placeholder.",
                [
                    FieldError(
                        "UNKNOWN_PLACEHOLDER",
                        f"Not a placeholder of this email: {', '.join(unknown)}. Use {allowed}.",
                        "body",
                    )
                ],
            )

    async def save(self, actor: Actor, kind: str, body: MailTemplateBody) -> MailTemplateList:
        self._check(kind, body)
        await self.templates.save(kind, body.subject, body.body, actor.id, self.clock.now())
        await self.uow.commit()
        return await self.list_all()

    async def reset(self, kind: str) -> MailTemplateList:
        await self.templates.remove(kind)
        await self.uow.commit()
        return await self.list_all()

    def preview(self, kind: str, body: MailTemplateBody) -> MailPreview:
        self._check(kind, body)
        subject = render_text(body.subject, kind, SAMPLE)
        return MailPreview(
            subject=subject,
            text=render_text(body.body, kind, SAMPLE),
            html=html_custom(subject, render_html(body.body, kind, SAMPLE), SAMPLE, kind),
        )
