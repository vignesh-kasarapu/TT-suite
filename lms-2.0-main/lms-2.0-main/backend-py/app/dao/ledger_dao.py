from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ledger import LeaveLedger


def sum_quantity(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int) -> float:
    """BR-07: balance is never stored/mutated directly — always summed from the ledger."""
    result = db.execute(
        select(func.sum(LeaveLedger.quantity)).where(
            LeaveLedger.employee_id == employee_id,
            LeaveLedger.leave_type_id == leave_type_id,
            LeaveLedger.leave_year_id == leave_year_id,
        )
    ).scalar_one()
    return float(result or 0)


def _target_filter(leave_type_id: int | None, pool_id: int | None):
    """A pooled balance is summed by pool; an unpooled one by leave type. Rows posted
    before pools existed carry `pool_id IS NULL` and stay with their leave type."""
    if pool_id is not None:
        return (LeaveLedger.pool_id == pool_id,)
    return (LeaveLedger.leave_type_id == leave_type_id, LeaveLedger.pool_id.is_(None))


def sum_for_target(
    db: Session, employee_id: int, leave_year_id: int, *, leave_type_id: int | None = None,
    pool_id: int | None = None, entry_types: tuple[str, ...] | None = None,
) -> float:
    """Signed sum over one employee's entries for a target (pool or type), optionally
    limited to certain entry types — which is how the dashboard separates the entitlement
    grant from carry-forward, adjustments and leave taken."""
    stmt = select(func.sum(LeaveLedger.quantity)).where(
        LeaveLedger.employee_id == employee_id,
        LeaveLedger.leave_year_id == leave_year_id,
        *_target_filter(leave_type_id, pool_id),
    )
    if entry_types is not None:
        stmt = stmt.where(LeaveLedger.entry_type.in_(entry_types))
    return float(db.execute(stmt).scalar_one() or 0)


def list_for_target(
    db: Session, employee_id: int, leave_year_id: int, *, leave_type_id: int | None = None,
    pool_id: int | None = None,
):
    stmt = select(LeaveLedger).where(
        LeaveLedger.employee_id == employee_id,
        LeaveLedger.leave_year_id == leave_year_id,
        *_target_filter(leave_type_id, pool_id),
    )
    return list(db.execute(stmt.order_by(LeaveLedger.created_at.asc())).scalars())


def create_entry(db: Session, **fields) -> LeaveLedger:
    row = LeaveLedger(**fields)
    db.add(row)
    db.flush()
    return row


def find_by_source_reference(db: Session, source_reference: str) -> LeaveLedger | None:
    """The real per-employee/type/period idempotency check for accrual and
    carry-forward jobs — source_reference is a unique-by-construction key,
    not a DB constraint."""
    return db.execute(select(LeaveLedger).where(LeaveLedger.source_reference == source_reference)).scalars().first()


def list_for_employee(db: Session, employee_id: int, leave_year_id: int, leave_type_id: int | None = None):
    """One employee's entries for a leave year, optionally for a single leave type.

    Without the type filter the caller gets every type's entries mixed together, and a
    running balance over that list is the sum of all of them — which is what the Balance
    Adjustment screen used to show as "current balance" (BR-07: a balance is always per
    employee AND leave type AND year, exactly as `sum_quantity` above does it)."""
    stmt = select(LeaveLedger).where(
        LeaveLedger.employee_id == employee_id, LeaveLedger.leave_year_id == leave_year_id
    )
    if leave_type_id is not None:
        stmt = stmt.where(LeaveLedger.leave_type_id == leave_type_id)
    return list(db.execute(stmt.order_by(LeaveLedger.created_at.asc())).scalars())


def list_all_paginated(
    db: Session, *, employee_id=None, leave_type_id=None, leave_year_id=None, entry_type=None,
    date_from=None, date_to=None, page: int = 1, page_size: int = 50,
):
    from app.models.employee import Employee
    from app.models.leave_config import LeaveType

    stmt = select(LeaveLedger, Employee, LeaveType).join(Employee, Employee.employee_id == LeaveLedger.employee_id).join(
        LeaveType, LeaveType.leave_type_id == LeaveLedger.leave_type_id
    )
    if employee_id is not None:
        stmt = stmt.where(LeaveLedger.employee_id == employee_id)
    if leave_type_id is not None:
        stmt = stmt.where(LeaveLedger.leave_type_id == leave_type_id)
    if leave_year_id is not None:
        stmt = stmt.where(LeaveLedger.leave_year_id == leave_year_id)
    if entry_type is not None:
        stmt = stmt.where(LeaveLedger.entry_type == entry_type)
    if date_from is not None:
        stmt = stmt.where(LeaveLedger.created_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(LeaveLedger.created_at <= date_to)
    # The total is counted before paging so the client can render "page N of M" — returning
    # only the page's rows left it with no way to know how many pages there are.
    from sqlalchemy import func

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    stmt = stmt.order_by(LeaveLedger.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    return [tuple(row) for row in db.execute(stmt).all()], total


def list_for_leave_year(db: Session, leave_year_id: int):
    from app.models.employee import Employee
    from app.models.leave_config import LeaveType

    stmt = (
        select(LeaveLedger, Employee, LeaveType)
        .join(Employee, Employee.employee_id == LeaveLedger.employee_id)
        .join(LeaveType, LeaveType.leave_type_id == LeaveLedger.leave_type_id)
        .where(LeaveLedger.leave_year_id == leave_year_id)
        .order_by(LeaveLedger.employee_id.asc(), LeaveLedger.created_at.asc())
    )
    return [tuple(row) for row in db.execute(stmt).all()]
