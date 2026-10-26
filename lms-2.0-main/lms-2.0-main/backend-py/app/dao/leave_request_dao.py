"""LeaveRequest data access — the core of the leave lifecycle (Phase 3):
create/find/concurrency/overlap/aggregate. Read-heavy dashboard/team/report/
job-sweep views live in leave_request_query_dao.py (the ~250-line split)."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.leave_request import LeaveRequest

OVERLAP_BLOCKING_STATES = ("PENDING_MANAGER", "PENDING_HR", "APPROVED", "CANCELLATION_REQUESTED")
AGGREGATE_CANDIDATE_STATES = ("PENDING_MANAGER", "PENDING_HR", "APPROVED")


def create(db: Session, **fields) -> LeaveRequest:
    row = LeaveRequest(**fields)
    db.add(row)
    db.flush()
    return row


def find_by_id(db: Session, request_id: int) -> LeaveRequest | None:
    return db.get(LeaveRequest, request_id)


def find_by_id_for_update(db: Session, request_id: int) -> LeaveRequest | None:
    """SELECT ... FOR UPDATE — the pessimistic row lock Node takes via
    `lock: transaction.LOCK.UPDATE` inside decide/withdraw/requestCancellation/
    decideCancellation. Layered on top of lock_version's optimistic check
    (SQLAlchemy's version_id_col, already on the model) as a belt-and-suspenders
    pair, matching Node exactly."""
    return db.execute(
        select(LeaveRequest).where(LeaveRequest.request_id == request_id).with_for_update()
    ).scalars().first()


def find_approved_overlapping_date(db: Session, on_date: date) -> list[LeaveRequest]:
    return list(
        db.execute(
            select(LeaveRequest).where(
                LeaveRequest.state == "APPROVED",
                LeaveRequest.start_date <= on_date,
                LeaveRequest.end_date >= on_date,
            )
        ).scalars()
    )


def find_overlapping_for_employee(
    db: Session, employee_id: int, start_date: date, end_date: date, exclude_request_id: int | None = None
) -> LeaveRequest | None:
    """LMS-037: refuse overlap with the employee's own request in Pending/
    Approved/Cancellation Requested."""
    stmt = select(LeaveRequest).where(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.state.in_(OVERLAP_BLOCKING_STATES),
        LeaveRequest.start_date <= end_date,
        LeaveRequest.end_date >= start_date,
    )
    if exclude_request_id is not None:
        stmt = stmt.where(LeaveRequest.request_id != exclude_request_id)
    return db.execute(stmt).scalars().first()


def list_own(db: Session, employee_id: int) -> list[LeaveRequest]:
    return list(
        db.execute(
            select(LeaveRequest).where(LeaveRequest.employee_id == employee_id).order_by(LeaveRequest.created_at.desc())
        ).scalars()
    )


def sum_deducted_days_in_states(db: Session, employee_id: int, leave_type_id: int, leave_year_id: int, states: tuple[str, ...]) -> float:
    from sqlalchemy import func

    result = db.execute(
        select(func.sum(LeaveRequest.deducted_days)).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.leave_type_id == leave_type_id,
            LeaveRequest.leave_year_id == leave_year_id,
            LeaveRequest.state.in_(states),
        )
    ).scalar_one()
    return float(result or 0)


def find_aggregate_candidates(db: Session, employee_id: int, leave_type_id: int | None = None) -> list[LeaveRequest]:
    """BR-24 candidate pool: Pending/Approved only. leave_type_id filter is
    used for BR-44's sick-only aggregation."""
    stmt = select(LeaveRequest).where(
        LeaveRequest.employee_id == employee_id, LeaveRequest.state.in_(AGGREGATE_CANDIDATE_STATES)
    )
    if leave_type_id is not None:
        stmt = stmt.where(LeaveRequest.leave_type_id == leave_type_id)
    return list(db.execute(stmt).scalars())
