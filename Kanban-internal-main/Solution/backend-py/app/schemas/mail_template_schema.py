"""Edited email wording (D-141)."""

from typing import Literal

from pydantic import Field

from app.schemas.common_schema import CamelModel, RequestModel
from app.utils.time import UtcDateTime

MailKind = Literal[
    "invited",
    "assigned",
    "blocked",
    "comment",
    "closed",
    "time_reminder",
    "time_shortfall",
    "time_shortfall_lead",
    "time_team_report",
    "contact_admin",
]


class MailTemplate(CamelModel):
    kind: MailKind
    label: str
    placeholders: list[str] = Field(description="Usable as {name} in the subject and text.")
    subject: str = Field(description="What the email uses now (the default when not edited).")
    body: str
    default_subject: str
    default_body: str
    edited: bool
    updated_at: UtcDateTime | None


class MailTemplateList(CamelModel):
    items: list[MailTemplate]


class MailTemplateBody(RequestModel):
    subject: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1, max_length=10000)


class MailPreview(CamelModel):
    subject: str
    text: str
    html: str = Field(description="The email as Outlook shows it, filled with sample values.")
