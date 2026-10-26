from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.r3_extras import OptionalHolidaySelection


def find_selection(db: Session, employee_id: int, holiday_id: int) -> OptionalHolidaySelection | None:
    return db.execute(
        select(OptionalHolidaySelection).where(
            OptionalHolidaySelection.employee_id == employee_id, OptionalHolidaySelection.holiday_id == holiday_id
        )
    ).scalars().first()


def list_for_employee_year(db: Session, employee_id: int, leave_year_id: int) -> list[OptionalHolidaySelection]:
    return list(
        db.execute(
            select(OptionalHolidaySelection).where(
                OptionalHolidaySelection.employee_id == employee_id, OptionalHolidaySelection.leave_year_id == leave_year_id
            )
        ).scalars()
    )


def count_for_employee_year(db: Session, employee_id: int, leave_year_id: int) -> int:
    return db.execute(
        select(func.count()).select_from(OptionalHolidaySelection).where(
            OptionalHolidaySelection.employee_id == employee_id, OptionalHolidaySelection.leave_year_id == leave_year_id
        )
    ).scalar_one()


def list_for_year(db: Session, leave_year_id: int) -> list[OptionalHolidaySelection]:
    return list(db.execute(select(OptionalHolidaySelection).where(OptionalHolidaySelection.leave_year_id == leave_year_id)).scalars())


def create(db: Session, **fields) -> OptionalHolidaySelection:
    row = OptionalHolidaySelection(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete(db: Session, row: OptionalHolidaySelection) -> None:
    db.delete(row)
    db.commit()
