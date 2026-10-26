from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Notification, User
from app.models.enums import Role


# Events a user can switch off on their Profile page. Approval tasks, reminders and escalations always notify.
OPTIONAL_KINDS = ("APPROVED", "RETURNED", "PAID", "COMMENT")


def notify(db: Session, user_id: int | None, message: str, link: str = "", kind: str | None = None) -> None:
    if not user_id:
        return
    if kind in OPTIONAL_KINDS:
        user = db.get(User, user_id)
        if user and (user.notify_prefs or {}).get(kind) is False:
            return
    db.add(Notification(user_id=user_id, message=message, link=link))


def notify_role(db: Session, role: str, message: str, link: str = "", exclude: int | None = None) -> None:
    users = db.scalars(select(User).where(User.is_active, User.roles.contains([role]))).all()
    for u in users:
        if u.id != exclude:
            notify(db, u.id, message, link)


def notify_admins(db: Session, message: str, link: str = "") -> None:
    notify_role(db, Role.ADMIN, message, link)


def list_for(db: Session, user_id: int, limit: int = 50) -> list[Notification]:
    return list(
        db.scalars(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
    )


def unread_count(db: Session, user_id: int) -> int:
    return len(db.scalars(select(Notification.id).where(Notification.user_id == user_id, ~Notification.is_read)).all())


def mark_all_read(db: Session, user_id: int) -> None:
    db.execute(update(Notification).where(Notification.user_id == user_id).values(is_read=True))
    db.commit()
