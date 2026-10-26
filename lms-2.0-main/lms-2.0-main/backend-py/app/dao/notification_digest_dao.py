from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee_extras import NotificationDigestPreference


def is_digest_enabled(db: Session, employee_id: int) -> bool:
    row = db.execute(
        select(NotificationDigestPreference).where(NotificationDigestPreference.employee_id == employee_id)
    ).scalars().first()
    return bool(row and row.digest_enabled)


def list_opted_in(db: Session) -> list[NotificationDigestPreference]:
    return list(
        db.execute(select(NotificationDigestPreference).where(NotificationDigestPreference.digest_enabled.is_(True))).scalars()
    )


def find_by_employee(db: Session, employee_id: int) -> NotificationDigestPreference | None:
    return db.execute(
        select(NotificationDigestPreference).where(NotificationDigestPreference.employee_id == employee_id)
    ).scalars().first()


def set_enabled(db: Session, employee_id: int, enabled: bool) -> NotificationDigestPreference:
    row = find_by_employee(db, employee_id)
    if row is None:
        row = NotificationDigestPreference(employee_id=employee_id, digest_enabled=enabled)
        db.add(row)
    else:
        row.digest_enabled = enabled
    db.commit()
    db.refresh(row)
    return row
