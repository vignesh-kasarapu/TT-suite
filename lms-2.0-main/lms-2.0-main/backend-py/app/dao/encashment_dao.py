from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.r3_extras import LeaveEncashmentRequest


def create(db: Session, **fields) -> LeaveEncashmentRequest:
    row = LeaveEncashmentRequest(**fields)
    db.add(row)
    db.flush()
    return row


def list_for_employee(db: Session, employee_id: int) -> list[LeaveEncashmentRequest]:
    return list(
        db.execute(
            select(LeaveEncashmentRequest)
            .where(LeaveEncashmentRequest.employee_id == employee_id)
            .order_by(LeaveEncashmentRequest.requested_at.desc())
        ).scalars()
    )
