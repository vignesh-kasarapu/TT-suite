from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.self_approval import SelfApprovalPermission


def find_active(db: Session, employee_id: int, on_date: date) -> SelfApprovalPermission | None:
    return db.execute(
        select(SelfApprovalPermission).where(
            SelfApprovalPermission.employee_id == employee_id,
            SelfApprovalPermission.is_active.is_(True),
            SelfApprovalPermission.effective_from <= on_date,
            (SelfApprovalPermission.effective_to.is_(None)) | (SelfApprovalPermission.effective_to >= on_date),
        )
    ).scalars().first()


def find_any_active(db: Session, employee_id: int) -> SelfApprovalPermission | None:
    return db.execute(
        select(SelfApprovalPermission).where(
            SelfApprovalPermission.employee_id == employee_id, SelfApprovalPermission.is_active.is_(True)
        )
    ).scalars().first()


def create(db: Session, **fields) -> SelfApprovalPermission:
    row = SelfApprovalPermission(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def find_by_id(db: Session, grant_id: int) -> SelfApprovalPermission | None:
    return db.get(SelfApprovalPermission, grant_id)


def save(db: Session, row: SelfApprovalPermission) -> SelfApprovalPermission:
    db.commit()
    db.refresh(row)
    return row


def list_all(db: Session) -> list[SelfApprovalPermission]:
    return list(db.execute(select(SelfApprovalPermission).order_by(SelfApprovalPermission.created_at.desc())).scalars())
