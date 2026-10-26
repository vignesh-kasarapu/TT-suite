from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notification_audit import ScheduledJobRun


def find_by_type_and_period(db: Session, job_type: str, period_key: str) -> ScheduledJobRun | None:
    return db.execute(
        select(ScheduledJobRun).where(ScheduledJobRun.job_type == job_type, ScheduledJobRun.period_key == period_key)
    ).scalars().first()


def create(db: Session, **fields) -> ScheduledJobRun:
    row = ScheduledJobRun(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save(db: Session, row: ScheduledJobRun) -> ScheduledJobRun:
    db.commit()
    db.refresh(row)
    return row
