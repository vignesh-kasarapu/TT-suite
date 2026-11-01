from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.r3_extras import CompensatoryOffCredit


def find_existing(
    db: Session, employee_id: int, work_date: date, exclude_statuses: tuple[str, ...] = ()
) -> CompensatoryOffCredit | None:
    """One claim per employee per work date. A rejected claim does not block a corrected
    resubmission, which is what `exclude_statuses` is for."""
    stmt = select(CompensatoryOffCredit).where(
        CompensatoryOffCredit.employee_id == employee_id, CompensatoryOffCredit.work_date == work_date
    )
    if exclude_statuses:
        stmt = stmt.where(CompensatoryOffCredit.status.notin_(exclude_statuses))
    return db.execute(stmt).scalars().first()


def find_by_id(db: Session, comp_off_id: int) -> CompensatoryOffCredit | None:
    return db.get(CompensatoryOffCredit, comp_off_id)


def find_by_id_for_update(db: Session, comp_off_id: int) -> CompensatoryOffCredit | None:
    """Row lock: two approvals racing must not both write a credit."""
    return db.execute(
        select(CompensatoryOffCredit).where(CompensatoryOffCredit.comp_off_id == comp_off_id).with_for_update()
    ).scalars().first()


def create(db: Session, **fields) -> CompensatoryOffCredit:
    row = CompensatoryOffCredit(**fields)
    db.add(row)
    db.flush()
    return row


def list_for_employee(db: Session, employee_id: int) -> list[CompensatoryOffCredit]:
    return list(
        db.execute(
            select(CompensatoryOffCredit)
            .where(CompensatoryOffCredit.employee_id == employee_id)
            .order_by(CompensatoryOffCredit.work_date.desc())
        ).scalars()
    )


def list_requests(
    db: Session, *, status: str | None = None, statuses: tuple[str, ...] | None = None,
    employee_ids: list[int] | None = None,
) -> list[tuple[CompensatoryOffCredit, Employee]]:
    """Requests plus their employee — the approval queues and the HR list read this.
    `statuses` is for a queue that spans both stages (HR can decide either one)."""
    stmt = select(CompensatoryOffCredit, Employee).join(
        Employee, Employee.employee_id == CompensatoryOffCredit.employee_id
    )
    if status is not None:
        stmt = stmt.where(CompensatoryOffCredit.status == status)
    if statuses is not None:
        stmt = stmt.where(CompensatoryOffCredit.status.in_(statuses))
    if employee_ids is not None:
        stmt = stmt.where(CompensatoryOffCredit.employee_id.in_(employee_ids or [-1]))
    return [tuple(row) for row in db.execute(stmt.order_by(CompensatoryOffCredit.work_date.desc())).all()]


def list_for_report(
    db: Session, *, from_date: date | None = None, to_date: date | None = None, status: str | None = None,
    employee_id: int | None = None, employee_ids: list[int] | None = None,
) -> list[tuple[CompensatoryOffCredit, Employee]]:
    stmt = select(CompensatoryOffCredit, Employee).join(
        Employee, Employee.employee_id == CompensatoryOffCredit.employee_id
    )
    if from_date is not None:
        stmt = stmt.where(CompensatoryOffCredit.work_date >= from_date)
    if to_date is not None:
        stmt = stmt.where(CompensatoryOffCredit.work_date <= to_date)
    if status is not None:
        stmt = stmt.where(CompensatoryOffCredit.status == status)
    if employee_id is not None:
        allowed = employee_ids is None or employee_id in employee_ids
        stmt = stmt.where(CompensatoryOffCredit.employee_id == (employee_id if allowed else -1))
    elif employee_ids is not None:
        stmt = stmt.where(CompensatoryOffCredit.employee_id.in_(employee_ids))
    return [tuple(row) for row in db.execute(stmt.order_by(CompensatoryOffCredit.work_date.desc())).all()]
