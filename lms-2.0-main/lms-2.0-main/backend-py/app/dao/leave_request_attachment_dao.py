from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.leave_request import LeaveRequestAttachment


def create(db: Session, **fields) -> LeaveRequestAttachment:
    row = LeaveRequestAttachment(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def find_by_id(db: Session, attachment_id: int) -> LeaveRequestAttachment | None:
    return db.get(LeaveRequestAttachment, attachment_id)


def list_for_request(db: Session, request_id: int) -> list[LeaveRequestAttachment]:
    return list(
        db.execute(select(LeaveRequestAttachment).where(LeaveRequestAttachment.request_id == request_id)).scalars()
    )
