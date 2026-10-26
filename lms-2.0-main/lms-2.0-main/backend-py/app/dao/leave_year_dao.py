from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.leave_config import LeaveYear


def find_current(db: Session) -> LeaveYear | None:
    return db.execute(select(LeaveYear).where(LeaveYear.is_current.is_(True))).scalar_one_or_none()


def find_by_code(db: Session, year_code: str) -> LeaveYear | None:
    return db.execute(select(LeaveYear).where(LeaveYear.year_code == year_code)).scalar_one_or_none()


def find_by_id(db: Session, leave_year_id: int) -> LeaveYear | None:
    return db.get(LeaveYear, leave_year_id)


def list_open_years(db: Session, limit: int = 2) -> list[LeaveYear]:
    """LMS-077: the current + next open (not-yet-closed) leave years."""
    return list(
        db.execute(select(LeaveYear).where(LeaveYear.is_closed.is_(False)).order_by(LeaveYear.start_date.asc()).limit(limit)).scalars()
    )


def find_next_after(db: Session, end_date) -> LeaveYear | None:
    return db.execute(
        select(LeaveYear).where(LeaveYear.start_date > end_date).order_by(LeaveYear.start_date.asc())
    ).scalars().first()


def save(db: Session, row: LeaveYear) -> LeaveYear:
    db.commit()
    db.refresh(row)
    return row


def create(db: Session, **fields) -> LeaveYear:
    row = LeaveYear(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
