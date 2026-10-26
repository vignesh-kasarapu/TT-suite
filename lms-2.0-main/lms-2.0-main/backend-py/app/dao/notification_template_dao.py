from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org_config import NotificationTemplate


def list_all(db: Session) -> list[NotificationTemplate]:
    return list(db.execute(select(NotificationTemplate).order_by(NotificationTemplate.template_key)).scalars())


def find_by_key(db: Session, template_key: str) -> NotificationTemplate | None:
    return db.get(NotificationTemplate, template_key)


def create(db: Session, **fields) -> NotificationTemplate:
    row = NotificationTemplate(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save(db: Session, row: NotificationTemplate) -> NotificationTemplate:
    db.commit()
    db.refresh(row)
    return row


def delete(db: Session, row: NotificationTemplate) -> None:
    db.delete(row)
    db.commit()
