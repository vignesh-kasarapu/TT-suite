"""Helpers for creating and querying in-app notifications."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Notification


def create_notification(
    db: Session,
    user_id: int,
    type: str,
    title: str,
    body: Optional[str] = None,
    link: Optional[str] = None,
) -> Notification:
    """Build and stage a Notification. Does not commit — caller commits
    alongside its own transaction, matching record_audit's usage pattern."""
    notification = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        link=link,
    )
    db.add(notification)
    return notification


def get_unread_count(db: Session, user_id: int) -> int:
    return (
        db.query(func.count(Notification.id))
        .filter(Notification.user_id == user_id, Notification.read_at.is_(None))
        .scalar()
        or 0
    )


def mark_all_read(db: Session, user_id: int) -> int:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == user_id, Notification.read_at.is_(None))
        .update({"read_at": now}, synchronize_session=False)
    )
    return updated
