from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.leave_request import LeaveRequest
from app.models.r3_capacity import TeamCapacityLimit

OVERLAPPING_ON_LEAVE_STATES = ("PENDING_MANAGER", "PENDING_HR", "APPROVED")


def find_active_for_manager(db: Session, manager_id: int, start_date: date, end_date: date) -> TeamCapacityLimit | None:
    """The limit must cover the whole requested span (effective_from <= start,
    effective_to null-or->= end) — most-recently-effective match wins, matching
    Node's ORDER BY effective_from DESC + findOne."""
    return db.execute(
        select(TeamCapacityLimit)
        .where(
            TeamCapacityLimit.manager_employee_id == manager_id,
            TeamCapacityLimit.effective_from <= start_date,
            (TeamCapacityLimit.effective_to.is_(None)) | (TeamCapacityLimit.effective_to >= end_date),
        )
        .order_by(TeamCapacityLimit.effective_from.desc())
    ).scalars().first()


def list_for_manager(db: Session, manager_id: int) -> list[TeamCapacityLimit]:
    return list(
        db.execute(
            select(TeamCapacityLimit).where(TeamCapacityLimit.manager_employee_id == manager_id).order_by(TeamCapacityLimit.effective_from.desc())
        ).scalars()
    )


def list_all(db: Session) -> list[tuple[TeamCapacityLimit, Employee]]:
    stmt = (
        select(TeamCapacityLimit, Employee)
        .join(Employee, Employee.employee_id == TeamCapacityLimit.manager_employee_id)
        .order_by(TeamCapacityLimit.effective_from.desc())
    )
    return [tuple(row) for row in db.execute(stmt).all()]


def find_by_id(db: Session, capacity_limit_id: int) -> TeamCapacityLimit | None:
    return db.get(TeamCapacityLimit, capacity_limit_id)


def create(db: Session, **fields) -> TeamCapacityLimit:
    row = TeamCapacityLimit(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def save(db: Session, row: TeamCapacityLimit) -> TeamCapacityLimit:
    db.commit()
    db.refresh(row)
    return row


def delete(db: Session, row: TeamCapacityLimit) -> None:
    db.delete(row)
    db.commit()


def count_overlapping_teammates_on_leave(db: Session, manager_id: int, start_date: date, end_date: date) -> int:
    """LMS-086: direct reports only (not the recursive hierarchy). Deliberately
    does not exclude the requesting employee — matches Node's query exactly;
    harmless in practice since the check always runs before the employee's own
    request enters one of these states."""
    teammate_ids = select(Employee.employee_id).where(Employee.reporting_manager_id == manager_id)
    return db.execute(
        select(func.count(func.distinct(LeaveRequest.employee_id))).where(
            LeaveRequest.employee_id.in_(teammate_ids),
            LeaveRequest.state.in_(OVERLAPPING_ON_LEAVE_STATES),
            LeaveRequest.start_date <= end_date,
            LeaveRequest.end_date >= start_date,
        )
    ).scalar_one()
