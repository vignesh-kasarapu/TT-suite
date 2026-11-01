from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ledger import LeaveLedger
from app.models.r3_extras import LeaveEncashmentRequest


def create(db: Session, **fields) -> LeaveEncashmentRequest:
    row = LeaveEncashmentRequest(**fields)
    db.add(row)
    db.flush()
    return row


def find_by_id(db: Session, encashment_id: int) -> LeaveEncashmentRequest | None:
    return db.get(LeaveEncashmentRequest, encashment_id)


def find_by_id_for_update(db: Session, encashment_id: int) -> LeaveEncashmentRequest | None:
    """Row lock, so two HR admins deciding the same request at once cannot both post a debit."""
    return db.execute(
        select(LeaveEncashmentRequest).where(LeaveEncashmentRequest.encashment_id == encashment_id).with_for_update()
    ).scalars().first()


def lock_employee_balance(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> None:
    """Locks this employee's ledger rows for the type/year while a balance is checked and a
    request written. A balance is a SUM over rows (BR-07), so there is no single row to lock
    — holding the existing ones is what serialises two concurrent requests."""
    db.execute(
        select(LeaveLedger.entry_id).where(
            LeaveLedger.employee_id == employee_id,
            LeaveLedger.leave_type_id == leave_type_id,
            LeaveLedger.leave_year_id == leave_year_id,
        ).with_for_update()
    ).all()


def sum_days_in_status(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int, statuses: tuple[str, ...]) -> float:
    result = db.execute(
        select(func.sum(LeaveEncashmentRequest.days_encashed)).where(
            LeaveEncashmentRequest.employee_id == employee_id,
            LeaveEncashmentRequest.leave_type_id == leave_type_id,
            LeaveEncashmentRequest.leave_year_id == leave_year_id,
            LeaveEncashmentRequest.status.in_(statuses),
        )
    ).scalar_one()
    return float(result or 0)


def list_for_employee(db: Session, employee_id: int) -> list[LeaveEncashmentRequest]:
    return list(
        db.execute(
            select(LeaveEncashmentRequest)
            .where(LeaveEncashmentRequest.employee_id == employee_id)
            .order_by(LeaveEncashmentRequest.requested_at.desc())
        ).scalars()
    )


def list_all(db: Session, *, status: str | None = None, employee_id: int | None = None) -> list[LeaveEncashmentRequest]:
    stmt = select(LeaveEncashmentRequest)
    if status is not None:
        stmt = stmt.where(LeaveEncashmentRequest.status == status)
    if employee_id is not None:
        stmt = stmt.where(LeaveEncashmentRequest.employee_id == employee_id)
    return list(db.execute(stmt.order_by(LeaveEncashmentRequest.requested_at.desc())).scalars())


def list_for_report(
    db: Session, *, from_date=None, to_date=None, employee_id: int | None = None,
    employee_ids: list[int] | None = None, status: str | None = None, leave_year_id: int | None = None,
) -> list[tuple[LeaveEncashmentRequest, "object"]]:
    """Rows plus their employee, for the encashment report (same shape the other report
    DAOs return)."""
    from app.models.employee import Employee

    stmt = (
        select(LeaveEncashmentRequest, Employee)
        .join(Employee, Employee.employee_id == LeaveEncashmentRequest.employee_id)
    )
    if from_date is not None:
        stmt = stmt.where(LeaveEncashmentRequest.requested_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(LeaveEncashmentRequest.requested_at <= to_date)
    if status is not None:
        stmt = stmt.where(LeaveEncashmentRequest.status == status)
    if leave_year_id is not None:
        stmt = stmt.where(LeaveEncashmentRequest.leave_year_id == leave_year_id)
    if employee_id is not None:
        allowed = employee_ids is None or employee_id in employee_ids
        stmt = stmt.where(LeaveEncashmentRequest.employee_id == (employee_id if allowed else -1))
    elif employee_ids is not None:
        stmt = stmt.where(LeaveEncashmentRequest.employee_id.in_(employee_ids))
    return [tuple(row) for row in db.execute(stmt.order_by(LeaveEncashmentRequest.requested_at.desc())).all()]
