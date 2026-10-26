from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.leave_config import Holiday


def list_by_leave_year(db: Session, leave_year_id: int) -> list[Holiday]:
    return list(
        db.execute(
            select(Holiday).where(Holiday.leave_year_id == leave_year_id).order_by(Holiday.holiday_date)
        ).scalars()
    )


def find_by_id(db: Session, holiday_id: int) -> Holiday | None:
    return db.get(Holiday, holiday_id)


def create(db: Session, **fields) -> Holiday:
    row = Holiday(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete(db: Session, holiday: Holiday) -> None:
    db.delete(holiday)
    db.commit()


def list_for_years_scoped(db: Session, leave_year_ids: list[int], region_id: int | None) -> list[Holiday]:
    """LMS-077: holiday calendar view, scoped to the employee's own region
    (plus org-wide, region-less holidays), across multiple leave years."""
    stmt = select(Holiday).where(Holiday.leave_year_id.in_(leave_year_ids))
    if region_id is not None:
        stmt = stmt.where((Holiday.region_id.is_(None)) | (Holiday.region_id == region_id))
    else:
        stmt = stmt.where(Holiday.region_id.is_(None))
    return list(db.execute(stmt.order_by(Holiday.holiday_date.asc())).scalars())


def count_optional_for_year(db: Session, leave_year_id: int) -> int:
    from sqlalchemy import func

    return db.execute(
        select(func.count()).select_from(Holiday).where(Holiday.leave_year_id == leave_year_id, Holiday.is_optional.is_(True))
    ).scalar_one()


def list_eligible_optional(db: Session, leave_year_id: int, region_id: int | None) -> list[Holiday]:
    stmt = select(Holiday).where(Holiday.leave_year_id == leave_year_id, Holiday.is_optional.is_(True))
    if region_id is not None:
        stmt = stmt.where((Holiday.region_id.is_(None)) | (Holiday.region_id == region_id))
    else:
        stmt = stmt.where(Holiday.region_id.is_(None))
    return list(db.execute(stmt.order_by(Holiday.holiday_date.asc())).scalars())


def list_for_employee(db: Session, leave_year_id: int, employee_id: int | None) -> list[Holiday]:
    """Holidays scoped to the employee's region (or org-wide, region_id null) —
    a regional holiday only deducts/displays for employees working in that
    region. With no employeeId, only org-wide holidays match."""
    region_id = None
    if employee_id is not None:
        employee = db.get(Employee, employee_id)
        region_id = employee.region_id if employee else None

    stmt = select(Holiday).where(Holiday.leave_year_id == leave_year_id)
    if region_id is not None:
        stmt = stmt.where((Holiday.region_id.is_(None)) | (Holiday.region_id == region_id))
    else:
        stmt = stmt.where(Holiday.region_id.is_(None))
    return list(db.execute(stmt).scalars())
