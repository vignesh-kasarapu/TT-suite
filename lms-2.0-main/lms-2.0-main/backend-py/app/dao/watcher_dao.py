from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.delegation_watcher import StandingWatcher, Watcher


def list_for_request(db: Session, request_id: int) -> list[Watcher]:
    return list(db.execute(select(Watcher).where(Watcher.request_id == request_id)).scalars())


def find_existing(db: Session, request_id: int, watcher_employee_id: int) -> Watcher | None:
    return db.execute(
        select(Watcher).where(Watcher.request_id == request_id, Watcher.watcher_employee_id == watcher_employee_id)
    ).scalars().first()


def create(db: Session, **fields) -> Watcher:
    row = Watcher(**fields)
    db.add(row)
    db.flush()
    return row


def find_by_id(db: Session, watcher_id: int) -> Watcher | None:
    return db.get(Watcher, watcher_id)


def delete(db: Session, row: Watcher) -> None:
    db.delete(row)
    db.flush()


def list_active_standing_watchers(db: Session, watched_employee_id: int, on_date: date) -> list[StandingWatcher]:
    return list(
        db.execute(
            select(StandingWatcher).where(
                StandingWatcher.watched_employee_id == watched_employee_id,
                StandingWatcher.from_date <= on_date,
                StandingWatcher.to_date >= on_date,
            )
        ).scalars()
    )


def list_standing_watchers_for(db: Session, watched_employee_id: int) -> list[StandingWatcher]:
    return list(
        db.execute(
            select(StandingWatcher).where(StandingWatcher.watched_employee_id == watched_employee_id).order_by(StandingWatcher.from_date.desc())
        ).scalars()
    )


def find_overlapping_standing_watcher(db: Session, watched_employee_id: int, watcher_employee_id: int, from_date: date, to_date: date) -> StandingWatcher | None:
    return db.execute(
        select(StandingWatcher).where(
            StandingWatcher.watched_employee_id == watched_employee_id,
            StandingWatcher.watcher_employee_id == watcher_employee_id,
            StandingWatcher.from_date <= to_date,
            StandingWatcher.to_date >= from_date,
        )
    ).scalars().first()


def create_standing_watcher(db: Session, **fields) -> StandingWatcher:
    row = StandingWatcher(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
