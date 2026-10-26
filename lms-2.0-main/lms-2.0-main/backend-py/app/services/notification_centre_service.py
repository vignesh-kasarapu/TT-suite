"""Mirrors backend/src/services/notificationCentre.service.js (LMS-068) and
notificationAdmin.service.js's digest-preference self-service half (LMS-072).
The template-CRUD half of notificationAdmin.service.js is already ported —
see notification_template_service.py."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import notification_dao, notification_digest_dao


def list_for_employee(db: Session, employee_id: int, unread_only: bool = False):
    return notification_dao.list_in_app_for_employee(db, employee_id, unread_only)


def unread_count(db: Session, employee_id: int) -> int:
    return notification_dao.count_unread(db, employee_id)


def mark_read(db: Session, notification_id: int, employee_id: int):
    notification = notification_dao.find_by_id(db, notification_id)
    if notification is None or notification.recipient_id != employee_id:
        raise AppError("NOT_FOUND", "Notification not found.", status=404)
    notification_dao.mark_read(db, notification)
    return notification


def mark_all_read(db: Session, employee_id: int) -> None:
    notification_dao.mark_all_read(db, employee_id)


def get_my_digest_preference(db: Session, employee_id: int) -> bool:
    row = notification_digest_dao.find_by_employee(db, employee_id)
    return bool(row and row.digest_enabled)


def set_my_digest_preference(db: Session, employee_id: int, enabled: bool) -> bool:
    """LMS-072: a Manager may opt into a daily digest in place of individual
    per-request notifications."""
    row = notification_digest_dao.set_enabled(db, employee_id, enabled)
    return row.digest_enabled
