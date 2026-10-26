"""Mirrors backend/src/services/calendarFeed.service.js (LMS-082)."""
import hashlib
import re
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import calendar_feed_dao, employee_dao, leave_request_query_dao

_ESCAPE_RE = re.compile(r"([,;])")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_subscription(db: Session, employee_id: int, scope: str) -> str:
    """Creates a new feed subscription and returns the raw token once — only
    the hash is stored."""
    token = secrets.token_hex(24)
    calendar_feed_dao.create(db, employee_id=employee_id, feed_token_hash=_hash_token(token), scope=scope)
    return token


def revoke_subscription(db: Session, subscription_id: int, actor_id: int):
    sub = calendar_feed_dao.find_by_id(db, subscription_id)
    if sub is None or sub.employee_id != actor_id:
        raise AppError("NOT_FOUND", "Subscription not found.", status=404)
    from datetime import datetime, timezone

    sub.is_active = False
    sub.revoked_at = datetime.now(timezone.utc)
    calendar_feed_dao.save(db, sub)
    return sub


def list_subscriptions(db: Session, employee_id: int):
    return calendar_feed_dao.list_for_employee(db, employee_id)


def resolve_token(db: Session, token: str):
    """Never trusts an employeeId from the URL — the token itself is the
    only proof of identity, since this endpoint deliberately bypasses the
    normal session cookie so Outlook can poll it unattended."""
    sub = calendar_feed_dao.find_by_token_hash(db, _hash_token(token))
    if sub is None:
        raise AppError("INVALID_CALENDAR_TOKEN", "Invalid or revoked calendar feed link.", status=404)
    return sub


def _escape_ics_text(text: str) -> str:
    return _ESCAPE_RE.sub(r"\\\1", str(text)).replace("\n", "\\n")


def build_ics_feed(db: Session, subscription) -> str:
    employee_ids = [subscription.employee_id]
    if subscription.scope == "TEAM":
        employee_ids += [r.employee_id for r in employee_dao.list_direct_reports(db, subscription.employee_id)]

    rows = leave_request_query_dao.list_approved_for_employees(db, employee_ids)

    events = []
    for request, employee in rows:
        dtstart = request.start_date.strftime("%Y%m%d")
        # RFC 5545: DTEND on an all-day (VALUE=DATE) event is exclusive — a
        # leave running through end_date inclusive must set DTEND to
        # end_date + 1, or the last day of leave renders as still-working.
        dtend = (request.end_date + timedelta(days=1)).strftime("%Y%m%d")
        events.append(
            "\r\n".join(
                [
                    "BEGIN:VEVENT", f"UID:leave-{request.request_id}@lms", f"DTSTART;VALUE=DATE:{dtstart}",
                    f"DTEND;VALUE=DATE:{dtend}", f"SUMMARY:{_escape_ics_text(f'{employee.full_name} — Leave')}",
                    "END:VEVENT",
                ]
            )
        )

    return "\r\n".join(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//LMS 2.0//Calendar Feed//EN", "CALSCALE:GREGORIAN", *events, "END:VCALENDAR"])
