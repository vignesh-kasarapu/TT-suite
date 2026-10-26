from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee_extras import EmployeeFinalSettlement


def create(db: Session, **fields) -> EmployeeFinalSettlement:
    row = EmployeeFinalSettlement(**fields)
    db.add(row)
    db.flush()
    return row


def find_by_employee(db: Session, employee_id: int) -> EmployeeFinalSettlement | None:
    return db.execute(
        select(EmployeeFinalSettlement).where(EmployeeFinalSettlement.employee_id == employee_id)
    ).scalar_one_or_none()
