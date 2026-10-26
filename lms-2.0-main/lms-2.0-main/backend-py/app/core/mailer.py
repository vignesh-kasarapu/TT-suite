"""Mirrors backend/src/utils/mailer.js — basic-auth SMTP (Gmail app password),
configured via MAIL_HOST/MAIL_PORT/MAIL_USERNAME/MAIL_PASSWORD. The from
address is always the authenticated mailbox. Synchronous (the whole app is
sync SQLAlchemy) rather than Node's fire-and-forget async — callers already
send email after the DB commit, outside the request's own transaction, so a
slow/failing send still can't roll back the business action; it just adds
latency to the response instead of happening truly in the background."""
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")


def send_email(to_address: str, subject: str, body: str) -> None:
    if not settings.mail_host:
        logger.info("MAIL_HOST unset; not sending %r to %s", subject, to_address)
        return
    message = EmailMessage()
    message["From"] = settings.mail_username
    message["To"] = to_address
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP(settings.mail_host, settings.mail_port, timeout=10) as smtp:
        smtp.starttls()
        smtp.login(settings.mail_username, settings.mail_password)
        smtp.send_message(message)
