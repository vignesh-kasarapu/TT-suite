from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.r3_extras import CalendarFeedSubscription


def create(db: Session, **fields) -> CalendarFeedSubscription:
    row = CalendarFeedSubscription(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def find_by_id(db: Session, subscription_id: int) -> CalendarFeedSubscription | None:
    return db.get(CalendarFeedSubscription, subscription_id)


def find_by_token_hash(db: Session, token_hash: str) -> CalendarFeedSubscription | None:
    return db.execute(
        select(CalendarFeedSubscription).where(
            CalendarFeedSubscription.feed_token_hash == token_hash, CalendarFeedSubscription.is_active.is_(True)
        )
    ).scalars().first()


def list_for_employee(db: Session, employee_id: int) -> list[CalendarFeedSubscription]:
    return list(
        db.execute(select(CalendarFeedSubscription).where(CalendarFeedSubscription.employee_id == employee_id)).scalars()
    )


def save(db: Session, row: CalendarFeedSubscription) -> CalendarFeedSubscription:
    db.commit()
    db.refresh(row)
    return row
