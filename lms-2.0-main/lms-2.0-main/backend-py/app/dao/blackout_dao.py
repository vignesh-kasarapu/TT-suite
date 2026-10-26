from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.r3_capacity import BlackoutPeriod


def list_all(db: Session, include_inactive: bool = False) -> list[BlackoutPeriod]:
    stmt = select(BlackoutPeriod)
    if not include_inactive:
        stmt = stmt.where(BlackoutPeriod.is_active.is_(True))
    return list(db.execute(stmt.order_by(BlackoutPeriod.start_date.asc())).scalars())


def find_by_id(db: Session, blackout_id: int) -> BlackoutPeriod | None:
    return db.get(BlackoutPeriod, blackout_id)


def create(db: Session, **fields) -> BlackoutPeriod:
    row = BlackoutPeriod(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save(db: Session, row: BlackoutPeriod) -> BlackoutPeriod:
    db.commit()
    db.refresh(row)
    return row


def delete(db: Session, row: BlackoutPeriod) -> None:
    db.delete(row)
    db.commit()


def find_conflicting(db: Session, leave_type_id: int, start_date: date, end_date: date) -> BlackoutPeriod | None:
    """LMS-085: an active blackout matching this leave type or type-agnostic
    (leave_type_id IS NULL) that overlaps the span."""
    return db.execute(
        select(BlackoutPeriod).where(
            BlackoutPeriod.is_active.is_(True),
            BlackoutPeriod.start_date <= end_date,
            BlackoutPeriod.end_date >= start_date,
            (BlackoutPeriod.leave_type_id.is_(None)) | (BlackoutPeriod.leave_type_id == leave_type_id),
        )
    ).scalars().first()
