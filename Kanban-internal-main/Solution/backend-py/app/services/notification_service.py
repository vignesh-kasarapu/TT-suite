"""Sending the outbox (D-073/074/075): email through Microsoft Graph (or the dev/test stub
mailbox) and Teams messages through each team's webhook. Up to 50 pending rows per run; a failure
is recorded on the row and retried until 3 attempts. Each row is committed on its own, so one
bad row never holds back the others."""

import re
from typing import Any

import httpx

from app.core.clock import Clock
from app.core.config import Settings
from app.core.crypto import decrypt
from app.core.database import UnitOfWork
from app.core.logging import get_logger
from app.integrations import smtp_mail
from app.integrations.graph import GraphClient
from app.integrations.teams_webhook import post_message
from app.repositories.mail_template_repository import MailTemplateRepository
from app.repositories.notification_repository import NotificationRepository, NotificationRow
from app.repositories.team_repository import TeamRepository
from app.repositories.user_repository import UserRepository
from app.schemas.report_schema import DrainResult, NotificationList, StubMailList
from app.services.mail_html import html_custom, html_of
from app.services.mail_templates import KINDS, render_html, render_text

SUBJECT = {
    "invited": "You have been invited to Kanban",
    "assigned": "You were assigned",
    "blocked": "Your card is blocked",
    "comment": "New comment",
    "closed": "Card closed",
    "contact_admin": "Message from someone who cannot sign in",
}


_ADDRESS = re.compile(r"[^\s<>@]+@[^\s<>@]+")


def _no_addresses(text: str) -> str:
    """Mail servers quote the recipient in refusals; logs carry no email addresses (NFR-020).
    The outbox row keeps the full reply for the admin."""
    return _ADDRESS.sub("[address]", text)


def _attachments(p: dict[str, Any]) -> list[tuple[str, str]]:
    """D-140: a mail's file, kept in its outbox payload as {filename, content}."""
    a = p.get("attachment")
    if isinstance(a, dict) and isinstance(a.get("filename"), str):
        return [(a["filename"], str(a.get("content") or ""))]
    return []


def _hours(p: dict[str, Any]) -> str:
    return f"{p.get('total')} of {p.get('target')} h"


def _time_text(kind: str, p: dict[str, Any]) -> tuple[str, str]:
    """D-116 time mails: (subject, body)."""
    week, note = p.get("weekStart"), p.get("note") or "(no note)"
    if kind == "time_reminder":
        return (
            f"Your time this week: {_hours(p)}",
            f"You have logged {_hours(p)} for the week of {week}. Please log the rest on your "
            f"cards, and add a note or mark leave/holiday days for anything that explains the "
            f"difference: {p.get('url')}",
        )
    if kind == "time_shortfall":
        return (
            f"Last week's time is short: {_hours(p)}",
            f"For the week of {week} you logged {_hours(p)} ({p.get('shortBy')} h short). "
            f"Your team lead has been told. Please complete it and add a note or adjustments: "
            f"{p.get('url')}",
        )
    if kind == "time_shortfall_lead":
        return (
            f"{p.get('personName')} logged {_hours(p)} last week",
            f"{p.get('personName')} ({p.get('teamName')}) logged {_hours(p)} for the week of "
            f"{week} ({p.get('shortBy')} h short). Their note: {note}\n{p.get('url')}",
        )
    raw = p.get("rows")
    rows: list[Any] = raw if isinstance(raw, list) else []
    lines = [
        f"- {r.get('name')}: {_hours(r)}"
        + (f", short by {r.get('shortBy')} h" if r.get("shortBy") else "")
        + (f" - {r.get('note')}" if r.get("note") else "")
        for r in rows
        if isinstance(r, dict)
    ]
    return (
        f"Weekly time report: {p.get('teamName')}, week of {week}",
        f"Time logged by {p.get('teamName')} for the week of {week}:\n"
        + "\n".join(lines)
        + f"\n{p.get('url')}",
    )


def message_text(kind: str, p: dict[str, Any]) -> str:
    if kind.startswith("time_"):
        return _time_text(kind, p)[1]
    if kind == "contact_admin":
        return (
            f"{p.get('name')} <{p.get('email')}> cannot sign in to Kanban and wrote:\n\n"
            f"{p.get('message')}\n\nReply to them at {p.get('email')}. "
            f"If they should have access, invite them: {p.get('url')}"
        )
    if kind == "invited":
        return (
            f"{p.get('actorName')} invited you to Kanban. "
            f"Sign in with your Microsoft account at {p.get('url')}"
        )
    return (
        f"{SUBJECT[kind]}: {p.get('cardKey')} {p.get('cardTitle')} - "
        f"{p.get('actorName')}: {p.get('detail')}\n{p.get('url')}"
    )


def subject_of(kind: str, p: dict[str, Any]) -> str:
    if kind.startswith("time_"):
        return f"[Kanban] {_time_text(kind, p)[0]}"
    if kind == "contact_admin":
        return f"[Kanban] {SUBJECT[kind]}: {p.get('name')}"
    if kind == "invited":
        return f"[Kanban] {SUBJECT[kind]}"
    return f"[Kanban] {SUBJECT[kind]}: {p.get('cardKey')}"


class NotificationService:
    def __init__(
        self,
        uow: UnitOfWork,
        notifications: NotificationRepository,
        users: UserRepository,
        teams: TeamRepository,
        graph: GraphClient,
        http: httpx.AsyncClient,
        settings: Settings,
        clock: Clock,
        templates: MailTemplateRepository,
    ) -> None:
        self.uow = uow
        self.notifications = notifications
        self.templates = templates
        self.users = users
        self.teams = teams
        self.graph = graph
        self.http = http
        self.settings = settings
        self.clock = clock

    async def _send(self, n: NotificationRow) -> None:
        payload: dict[str, Any] = n.payload if isinstance(n.payload, dict) else {}
        if n.channel == "email":
            to = await self.users.email_of(n.target_id)
            if to is None:
                raise RuntimeError("recipient gone")
            edited = await self.templates.get(n.kind) if n.kind in KINDS else None
            if edited:  # D-141: the admins' wording, in the same layout
                subject = render_text(edited.subject, n.kind, payload)
                body = render_text(edited.body, n.kind, payload)
                html = html_custom(
                    subject, render_html(edited.body, n.kind, payload), payload, n.kind
                )
            else:
                subject, body = subject_of(n.kind, payload), message_text(n.kind, payload)
                html = html_of(n.kind, subject, payload)
            files = _attachments(payload)
            if self.settings.MAIL_PROVIDER == "stub":
                listed = "".join(f"\n[attached: {name}]" for name, _ in files)
                await self.notifications.stub_mail(
                    to=to, subject=subject, body=body + listed, now=self.clock.now()
                )
            elif self.settings.MAIL_PROVIDER == "smtp":
                await smtp_mail.send_mail(
                    self.settings,
                    to=to,
                    subject=subject,
                    body=body,
                    html=html,
                    attachments=files,
                )
            else:
                await self.graph.send_mail(
                    sender=self.settings.MAIL_SENDER,
                    to=to,
                    subject=subject,
                    body=body,
                    html=html,
                    attachments=files,
                )
            return
        enc = await self.teams.webhook_enc(n.target_id)
        if enc is None:
            raise RuntimeError("webhook removed")
        url = decrypt(self.settings.APP_SECRET, enc)
        await post_message(self.http, url, message_text(n.kind, payload))

    async def drain(self) -> DrainResult:
        sent = failed = 0
        for n in await self.notifications.pending():
            try:
                await self._send(n)
                await self.notifications.mark_sent(n, self.clock.now())
                sent += 1
                get_logger().info("notify_sent", jobName=f"{n.channel}:{n.kind}")
            except Exception as err:  # every failure is recorded and retried
                await self.uow.rollback()
                failed += 1
                get_logger().warning(
                    "notify_failed",
                    code="NOTIFY_FAILED",
                    # Allow-listed fields only (NFR-020): what was sent, and the server's answer.
                    jobName=f"{n.channel}:{n.kind}",
                    err={"type": type(err).__name__, "message": _no_addresses(str(err))[:300]},
                )
                await self.notifications.mark_failed(n, str(err) or type(err).__name__)
            await self.uow.commit()
        return DrainResult(sent=sent, failed=failed)

    async def outbox(self) -> NotificationList:
        return NotificationList.model_validate(
            {
                "items": [
                    {
                        "id": n.id,
                        "channel": n.channel,
                        "targetId": n.target_id,
                        "kind": n.kind,
                        "payload": n.payload,
                        "createdAt": n.created_at,
                        "sentAt": n.sent_at,
                        "attempts": n.attempts,
                        "lastError": n.last_error,
                    }
                    for n in await self.notifications.recent()
                ]
            }
        )

    async def mailbox(self) -> StubMailList:
        return StubMailList.model_validate(
            {
                "items": [
                    {
                        "id": m.id,
                        "to": m.to,
                        "subject": m.subject,
                        "body": m.body,
                        "createdAt": m.created_at,
                    }
                    for m in await self.notifications.stub_mailbox()
                ]
            }
        )
