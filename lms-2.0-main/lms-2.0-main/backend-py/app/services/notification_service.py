"""Mirrors backend/src/services/notification.service.js. Every mutating
leave-lifecycle step calls notify() rather than touching Notification/mailer
directly — templates are looked up and token-substituted here, once."""
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.mailer import send_email
from app.dao import employee_dao, notification_dao, notification_digest_dao, notification_template_dao

logger = logging.getLogger("uvicorn.error")

# LMS-072: ONLY these two ever get suppressed/digested — every other template
# (approved, rejected, LOP applied, etc.) is always sent immediately; those are
# outcomes the recipient needs to know about, not a queue to batch.
DIGESTIBLE_TEMPLATES = ("REQUEST_AWAITING_DECISION", "NEW_REQUEST_AWAITING_DECISION")

_TOKEN_RE = re.compile(r"\{\{(\w+)\}\}")


def _substitute(text: str, tokens: dict) -> str:
    return _TOKEN_RE.sub(lambda m: str(tokens.get(m.group(1), m.group(0))), text)


def notify(db: Session, *, recipient_id: int, template_key: str, tokens: dict | None = None, related_request_id: int | None = None):
    tokens = tokens or {}
    template = notification_template_dao.find_by_key(db, template_key)
    if template is None:
        raise AppError("TEMPLATE_NOT_SEEDED", f"Notification template '{template_key}' has not been seeded.", status=500)
    if not template.is_active:
        return None  # admin disabled it — silent no-op

    subject = _substitute(template.subject_template, tokens)
    body = _substitute(template.body_template, tokens)

    in_app = notification_dao.create(
        db, recipient_id=recipient_id, channel="IN_APP", template_key=template_key, subject=subject, body=body,
        status="SENT", related_request_id=related_request_id, sent_at=datetime.now(timezone.utc),
    )

    if template_key in DIGESTIBLE_TEMPLATES and notification_digest_dao.is_digest_enabled(db, recipient_id):
        notification_dao.create(
            db, recipient_id=recipient_id, channel="EMAIL", template_key=template_key, subject=subject, body=body,
            status="SUPPRESSED", related_request_id=related_request_id,
        )
        return in_app

    email_row = notification_dao.create(
        db, recipient_id=recipient_id, channel="EMAIL", template_key=template_key, subject=subject, body=body,
        status="PENDING", related_request_id=related_request_id,
    )
    _send_email_best_effort(db, email_row, recipient_id, subject, body)
    return in_app


def _send_email_best_effort(db: Session, email_row, recipient_id: int, subject: str, body: str) -> None:
    """Kept out of the caller's own business-transaction outcome — a mail
    outage can never roll back the business action; failures here are logged
    and recorded on the Notification row, never raised."""
    employee = employee_dao.find_by_id(db, recipient_id)
    if employee is None:
        notification_dao.mark_failed(db, email_row, "Recipient not found.")
        return
    try:
        send_email(employee.work_email, subject, body)
        notification_dao.mark_sent(db, email_row)
    except Exception as exc:  # noqa: BLE001 — deliberately broad, this must never propagate
        logger.warning("Email delivery failed for notification %s: %s", email_row.notification_id, exc)
        notification_dao.mark_failed(db, email_row, str(exc))
