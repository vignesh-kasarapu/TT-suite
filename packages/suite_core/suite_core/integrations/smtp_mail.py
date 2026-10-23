"""Email over SMTP (D-132): any SMTP server - port 465 is TLS from the start, any other port
upgrades with STARTTLS. Plain text plus the HTML version, as Graph sends. The standard library's
blocking client runs in a worker thread so the async notification worker is never held up."""

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from suite_core.integrations.settings import SuiteSettings as Settings

TIMEOUT_S = 20


def _message(
    settings: Settings,
    to: str,
    subject: str,
    body: str,
    html: str | None,
    attachments: list[tuple[str, str]] | None = None,
) -> EmailMessage:
    msg = EmailMessage()
    sender = settings.SMTP_FROM_ADDRESS or settings.MAIL_USERNAME
    msg["From"] = formataddr((" ".join(settings.MAIL_FROM_NAME.split()), sender))
    msg["To"] = to
    # A line break in a header is refused (no header injection), which would fail the mail for
    # good: card titles and contact-form names may hold one, so they become spaces.
    msg["Subject"] = " ".join(subject.split())
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")
    for name, text in attachments or []:  # D-140: e.g. the team's weekly time CSV
        msg.add_attachment(text.encode("utf-8"), maintype="text", subtype="csv", filename=name)
    return msg


def _send(settings: Settings, msg: EmailMessage) -> None:
    tls = ssl.create_default_context()
    try:
        if settings.MAIL_PORT == 465:
            with smtplib.SMTP_SSL(
                settings.MAIL_HOST, settings.MAIL_PORT, timeout=TIMEOUT_S, context=tls
            ) as smtp:
                smtp.login(settings.MAIL_USERNAME, settings.MAIL_PASSWORD)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(settings.MAIL_HOST, settings.MAIL_PORT, timeout=TIMEOUT_S) as smtp:
                smtp.starttls(context=tls)
                smtp.login(settings.MAIL_USERNAME, settings.MAIL_PASSWORD)
                smtp.send_message(msg)
    except smtplib.SMTPResponseException as err:
        # The server's own reply says why (e.g. 535 username and password not accepted).
        reply = err.smtp_error.decode(errors="replace") if isinstance(err.smtp_error, bytes) else ""
        raise RuntimeError(f"smtp {err.smtp_code} {reply}".strip()[:300]) from err
    except (smtplib.SMTPException, OSError) as err:
        raise RuntimeError(f"smtp {type(err).__name__}: {err}"[:300]) from err


async def send_mail(
    settings: Settings,
    *,
    to: str,
    subject: str,
    body: str,
    html: str | None = None,
    attachments: list[tuple[str, str]] | None = None,
) -> None:
    msg = _message(settings, to, subject, body, html, attachments)
    await asyncio.to_thread(_send, settings, msg)
