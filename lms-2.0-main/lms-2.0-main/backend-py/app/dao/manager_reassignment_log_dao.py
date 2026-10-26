from sqlalchemy.orm import Session

from app.models.working_pattern import ManagerReassignmentLog


def create(db: Session, **fields) -> ManagerReassignmentLog:
    row = ManagerReassignmentLog(**fields)
    db.add(row)
    db.flush()
    return row
