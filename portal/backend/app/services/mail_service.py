"""Suite emails through Kanban's mail stack (D-074, D-132): Graph sendMail or SMTP, from the
same sender mailbox Kanban already uses; `stub` (dev/test) only records them in the outbox.

Mail is queued in `app.mail_outbox` inside the caller's transaction and sent by the worker,
so an admin action never waits for (or fails on) the mail server - Kanban's outbox pattern.
"""

from dataclasses import dataclass
from html import escape
from typing import Any

import httpx

from app.core.config import Settings
from app.repositories.suite_repository import SuiteRepository
from suite_core.constants import APP_TITLES
from suite_core.integrations import smtp_mail
from suite_core.integrations.graph import GraphClient

MAX_ATTEMPTS = 5

ROLE_LABELS = {
    "admin": "Admin", "lead": "Lead", "member": "Member", "manager": "Manager",
    "employee": "Employee", "approver": "Approver", "finance": "Finance",
}


@dataclass(frozen=True)
class Rendered:
    subject: str
    text: str
    html: str


def _apps_lines(access: dict[str, Any]) -> list[str]:
    return [f"{APP_TITLES[a]} - {ROLE_LABELS.get(r, r)}" for a, r in access.items() if r]


def _html(paragraphs: list[str], bullets: list[str], url: str, button: str) -> str:
    items = "".join(f"<li>{escape(b)}</li>" for b in bullets)
    paras = "".join(f'<p style="margin:0 0 12px">{escape(p)}</p>' for p in paragraphs)
    return (
        '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#25231F;max-width:560px">'
        f'<p style="font-size:18px;font-weight:600;margin:0 0 16px">Tektalis Suite</p>{paras}'
        + (f'<ul style="margin:0 0 16px;padding-left:20px">{items}</ul>' if items else "")
        + f'<p><a href="{escape(url)}" style="display:inline-block;background:#2E6B45;color:#fff;'
        f'padding:10px 16px;border-radius:6px;text-decoration:none">{escape(button)}</a></p>'
        '<p style="color:#6B675F;font-size:12px">Sign in with your Microsoft work account.</p></div>'
    )


def render(kind: str, p: dict[str, Any]) -> Rendered:
    url = str(p.get("url", ""))
    if kind == "suite_invited":
        apps = _apps_lines(p.get("access", {}))
        intro = f"{p.get('actorName') or 'Your administrator'} invited you to the Tektalis Suite."
        lines = [intro, "You have access to:" if apps else "Your access will be set up by your admin."]
        text = "\n".join([*lines, *[f"  - {a}" for a in apps], "", f"Sign in with your Microsoft account: {url}"])
        return Rendered("[Tektalis] You have been invited to the Tektalis Suite", text, _html(lines, apps, url, "Open the dashboard"))
    if kind == "suite_access_changed":
        apps = _apps_lines(p.get("access", {}))
        lines = [
            f"{p.get('actorName') or 'Your administrator'} updated your Tektalis Suite access.",
            "You now have access to:" if apps else "You currently have no app access.",
        ]
        text = "\n".join([*lines, *[f"  - {a}" for a in apps], "", url])
        return Rendered("[Tektalis] Your app access was updated", text, _html(lines, apps, url, "Open the dashboard"))
    if kind == "request_access":
        app = APP_TITLES.get(str(p.get("app")), str(p.get("app")))
        lines = [
            f"{p.get('name')} ({p.get('email')}) asks for access to {app}.",
            f"Message: {p.get('message') or '-'}",
        ]
        return Rendered(f"[Tektalis] Access request: {app}", "\n".join([*lines, url]), _html(lines, [], url, "Open user administration"))
    raise ValueError(f"unknown mail kind {kind}")


class MailSender:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self.settings = settings
        self.graph = GraphClient(settings, http)

    async def send(self, to: str, msg: Rendered) -> None:
        s = self.settings
        if s.MAIL_PROVIDER == "graph":
            await self.graph.send_mail(sender=s.MAIL_SENDER, to=to, subject=msg.subject, body=msg.text, html=msg.html)
        elif s.MAIL_PROVIDER == "smtp":
            await smtp_mail.send_mail(s, to=to, subject=msg.subject, body=msg.text, html=msg.html)
        # stub: recorded in the outbox only (visible at GET /api/dev/mail)


async def drain(repo: SuiteRepository, sender: MailSender) -> int:
    """Send what is due; the caller commits. Returns how many were attempted."""
    due = await repo.due_mail()
    for mail_id, to, kind, payload, attempts in due:
        try:
            await sender.send(to, render(kind, payload))
            await repo.mail_sent(mail_id)
        except Exception as err:  # noqa: BLE001 - one bad mail must not stop the rest
            give_up = attempts + 1 >= MAX_ATTEMPTS
            await repo.mail_failed(mail_id, str(err), give_up, retry_in_s=60 * 2 ** attempts)
    return len(due)
