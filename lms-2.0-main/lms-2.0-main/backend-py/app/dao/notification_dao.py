from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.notification_audit import Notification


def find_reminder_since(db: Session, request_id: int, template_key: str, since: datetime) -> Notification | None:
    """A reminder already exists for this stage if one was sent since the SLA
    clock last started (sla_started_at resets on every escalation) — without
    this, a request sitting in the reminder band gets re-notified every tick."""
    return db.execute(
        select(Notification).where(
            Notification.related_request_id == request_id, Notification.template_key == template_key,
            Notification.created_at >= since,
        )
    ).scalars().first()


def list_suppressed_for_employee(db: Session, employee_id: int) -> list[Notification]:
    return list(
        db.execute(
            select(Notification)
            .where(Notification.recipient_id == employee_id, Notification.channel == "EMAIL", Notification.status == "SUPPRESSED")
            .order_by(Notification.created_at.asc())
        ).scalars()
    )


def bulk_mark_sent(db: Session, notification_ids: list[int]) -> None:
    if not notification_ids:
        return
    db.execute(
        update(Notification)
        .where(Notification.notification_id.in_(notification_ids))
        .values(status="SENT", sent_at=datetime.now())
    )
    db.commit()


def list_in_app_for_employee(db: Session, employee_id: int, unread_only: bool = False, limit: int = 100) -> list[Notification]:
    stmt = select(Notification).where(Notification.recipient_id == employee_id, Notification.channel == "IN_APP")
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc()).limit(limit)
    return list(db.execute(stmt).scalars())


def count_unread(db: Session, employee_id: int) -> int:
    from sqlalchemy import func

    return db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.recipient_id == employee_id, Notification.channel == "IN_APP", Notification.read_at.is_(None)
        )
    ).scalar_one()


def find_by_id(db: Session, notification_id: int) -> Notification | None:
    return db.get(Notification, notification_id)


def mark_read(db: Session, notification: Notification) -> None:
    from datetime import datetime

    notification.read_at = datetime.now()
    db.commit()


def mark_all_read(db: Session, employee_id: int) -> None:
    from datetime import datetime

    db.execute(
        update(Notification)
        .where(Notification.recipient_id == employee_id, Notification.channel == "IN_APP", Notification.read_at.is_(None))
        .values(read_at=datetime.now())
    )
    db.commit()


def create(db: Session, **fields) -> Notification:
    row = Notification(**fields)
    db.add(row)
    db.flush()
    return row


def mark_sent(db: Session, row: Notification) -> None:
    from datetime import datetime, timezone

    row.status = "SENT"
    row.sent_at = datetime.now(timezone.utc)
    db.flush()


def mark_failed(db: Session, row: Notification, error_message: str) -> None:
    row.status = "FAILED"
    row.error_message = error_message
    db.flush()
