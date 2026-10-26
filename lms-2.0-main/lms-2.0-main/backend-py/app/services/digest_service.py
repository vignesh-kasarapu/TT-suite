"""Mirrors backend/src/jobs/digest.job.js. LMS-072: once a day, gather every
SUPPRESSED per-request email created since the last digest for each opted-in
recipient and send one summary email instead. In-app notifications were never
suppressed (LMS-068) — this only ever affects the email channel. No
ScheduledJobRun row — idempotency comes from the query predicate itself
(SUPPRESSED -> SENT is a one-way transition, so a second run finds nothing left)."""
import logging

from sqlalchemy.orm import Session

from app.core.mailer import send_email
from app.dao import employee_dao, notification_dao, notification_digest_dao

logger = logging.getLogger("uvicorn.error")


def run_daily_digest(db: Session) -> None:
    for preference in notification_digest_dao.list_opted_in(db):
        suppressed = notification_dao.list_suppressed_for_employee(db, preference.employee_id)
        if not suppressed:
            continue

        employee = employee_dao.find_by_id(db, preference.employee_id)
        if employee is None:
            continue

        items = "".join(f"<li>{n.subject}</li>" for n in suppressed)
        body = f"<p>You have {len(suppressed)} item(s) awaiting your decision:</p><ul>{items}</ul>"
        subject = f"Daily digest: {len(suppressed)} pending approval(s)"

        try:
            send_email(employee.work_email, subject, body)
            # LMS-070: a digest failure is logged, not thrown — it never
            # blocks anything else. Rows are only marked SENT on success; a
            # failed attempt leaves them SUPPRESSED for the next day's run.
            notification_dao.bulk_mark_sent(db, [n.notification_id for n in suppressed])
        except Exception as exc:  # noqa: BLE001
            logger.error("Digest send failed for employee %s: %s", preference.employee_id, exc)
