from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.ledger import LopRecord


def find_by_request_id(db: Session, request_id: int) -> LopRecord | None:
    return db.execute(select(LopRecord).where(LopRecord.request_id == request_id)).scalars().first()


def create(db: Session, **fields) -> LopRecord:
    row = LopRecord(**fields)
    db.add(row)
    db.flush()
    return row


def list_for_report(
    db: Session, *, from_date: date | None = None, to_date: date | None = None,
    employee_id: int | None = None, employee_ids: list[int] | None = None,
) -> list[tuple[LopRecord, Employee]]:
    """LMS-078: LOP report for downstream payroll consumption."""
    stmt = select(LopRecord, Employee).join(Employee, Employee.employee_id == LopRecord.employee_id)
    if from_date is not None:
        stmt = stmt.where(LopRecord.start_date >= from_date)
    if to_date is not None:
        stmt = stmt.where(LopRecord.end_date <= to_date)

    if employee_id is not None:
        allowed = employee_ids is None or employee_id in employee_ids
        stmt = stmt.where(LopRecord.employee_id == (employee_id if allowed else -1))
    elif employee_ids is not None:
        stmt = stmt.where(LopRecord.employee_id.in_(employee_ids))

    stmt = stmt.order_by(LopRecord.converted_at.desc())
    return [tuple(row) for row in db.execute(stmt).all()]
