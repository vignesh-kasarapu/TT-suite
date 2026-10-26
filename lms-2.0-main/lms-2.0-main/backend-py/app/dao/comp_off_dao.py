from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.r3_extras import CompensatoryOffCredit


def find_existing(db: Session, employee_id: int, work_date: date) -> CompensatoryOffCredit | None:
    return db.execute(
        select(CompensatoryOffCredit).where(
            CompensatoryOffCredit.employee_id == employee_id, CompensatoryOffCredit.work_date == work_date
        )
    ).scalars().first()


def create(db: Session, **fields) -> CompensatoryOffCredit:
    row = CompensatoryOffCredit(**fields)
    db.add(row)
    db.flush()
    return row


def list_for_employee(db: Session, employee_id: int) -> list[CompensatoryOffCredit]:
    return list(
        db.execute(
            select(CompensatoryOffCredit).where(CompensatoryOffCredit.employee_id == employee_id).order_by(CompensatoryOffCredit.work_date.desc())
        ).scalars()
    )
