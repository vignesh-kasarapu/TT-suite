"""Read-heavy LeaveRequest views that aren't part of the core lifecycle
itself — dashboard/team/calendar/report/job-sweep/lifecycle queries. Split
out of leave_request_dao.py to stay under the ~250-line-per-file rule; the
core create/find/overlap/aggregate functions used by the leave_request
service package remain there."""
from datetime import date

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.leave_request import LeaveRequest


def list_pending_for_employee(db: Session, employee_id: int) -> list[LeaveRequest]:
    return list(
        db.execute(
            select(LeaveRequest).where(
                LeaveRequest.employee_id == employee_id, LeaveRequest.state.in_(("PENDING_MANAGER", "PENDING_HR"))
            )
        ).scalars()
    )


def list_upcoming_approved(db: Session, employee_id: int, on_or_after, limit: int) -> list[LeaveRequest]:
    return list(
        db.execute(
            select(LeaveRequest)
            .where(LeaveRequest.employee_id == employee_id, LeaveRequest.state == "APPROVED", LeaveRequest.end_date >= on_or_after)
            .order_by(LeaveRequest.start_date.asc())
            .limit(limit)
        ).scalars()
    )


def list_withdrawal_window(db: Session, employee_id: int) -> list[LeaveRequest]:
    return list(
        db.execute(
            select(LeaveRequest).where(
                LeaveRequest.employee_id == employee_id, LeaveRequest.state == "REJECTED_PENDING_WITHDRAWAL"
            )
        ).scalars()
    )


def list_approved_for_employees(db: Session, employee_ids: list[int]) -> list[tuple[LeaveRequest, Employee]]:
    """Calendar feed (ICS) — every APPROVED request for the given employee set."""
    if not employee_ids:
        return []
    stmt = (
        select(LeaveRequest, Employee)
        .join(Employee, Employee.employee_id == LeaveRequest.employee_id)
        .where(LeaveRequest.employee_id.in_(employee_ids), LeaveRequest.state == "APPROVED")
    )
    return [tuple(row) for row in db.execute(stmt).all()]


def list_for_employees_overlapping(
    db: Session, employee_ids: list[int], start_date, end_date, states: tuple[str, ...]
) -> list[LeaveRequest]:
    """Backs team-calendar/peer-calendar — every request for the given
    employee set overlapping [start_date, end_date] in the given states."""
    if not employee_ids:
        return []
    return list(
        db.execute(
            select(LeaveRequest).where(
                LeaveRequest.employee_id.in_(employee_ids), LeaveRequest.state.in_(states),
                LeaveRequest.start_date <= end_date, LeaveRequest.end_date >= start_date,
            )
        ).scalars()
    )


def list_stuck_for_approver(db: Session, approver_id: int) -> list[LeaveRequest]:
    """Requests currently routed to this employee for a decision — used at
    deactivation time to find anything that would otherwise be stuck forever."""
    return list(
        db.execute(
            select(LeaveRequest).where(
                LeaveRequest.current_approver_id == approver_id,
                LeaveRequest.state.in_(("PENDING_MANAGER", "PENDING_HR", "CANCELLATION_REQUESTED")),
            )
        ).scalars()
    )


def bulk_reassign_approver(db: Session, request_ids: list[int], new_approver_id: int | None) -> None:
    if not request_ids:
        return
    db.execute(update(LeaveRequest).where(LeaveRequest.request_id.in_(request_ids)).values(current_approver_id=new_approver_id))
    db.flush()


def bulk_transfer_pending_manager(db: Session, employee_id: int, old_manager_id: int | None, new_manager_id: int) -> None:
    db.execute(
        update(LeaveRequest)
        .where(LeaveRequest.employee_id == employee_id, LeaveRequest.current_approver_id == old_manager_id, LeaveRequest.state == "PENDING_MANAGER")
        .values(current_approver_id=new_manager_id)
    )
    db.flush()


def list_manager_queue(db: Session, viewer_id: int) -> list[LeaveRequest]:
    return list(
        db.execute(
            select(LeaveRequest)
            .where(
                LeaveRequest.current_approver_id == viewer_id,
                LeaveRequest.state.in_(("PENDING_MANAGER", "CANCELLATION_REQUESTED")),
            )
            .order_by(LeaveRequest.sla_started_at.asc())
        ).scalars()
    )


def list_hr_queue(db: Session) -> list[LeaveRequest]:
    """PENDING_HR is a role grant, not a person — every HR/Admin sees every
    PENDING_HR request, plus any CANCELLATION_REQUESTED with no
    current_approver_id (an employee with no manager on record — HR is the
    fallback)."""
    return list(
        db.execute(
            select(LeaveRequest)
            .where(
                (LeaveRequest.state == "PENDING_HR")
                | ((LeaveRequest.state == "CANCELLATION_REQUESTED") & (LeaveRequest.current_approver_id.is_(None)))
            )
            .order_by(LeaveRequest.sla_started_at.asc())
        ).scalars()
    )


def list_pending_with_sla(db: Session) -> list[LeaveRequest]:
    """SLA sweep candidate pool — every request still awaiting a Manager/HR
    decision, regardless of who it's routed to (the job scans all of them
    every tick)."""
    return list(
        db.execute(select(LeaveRequest).where(LeaveRequest.state.in_(("PENDING_MANAGER", "PENDING_HR")))).scalars()
    )


def list_expired_advance_rejections(db: Session, now) -> list[LeaveRequest]:
    """BR-18/19/20 LOP conversion candidate pool."""
    return list(
        db.execute(
            select(LeaveRequest).where(
                LeaveRequest.state == "REJECTED_PENDING_WITHDRAWAL", LeaveRequest.withdrawal_window_end < now
            )
        ).scalars()
    )


def list_pending_lop_conversions(db: Session, now) -> list[LeaveRequest]:
    """The other half of the same pool: rejected advance leave whose withdrawal window is
    still open. These have NOT become loss of pay yet — the employee can still withdraw —
    but they will on the next sweep if nobody acts, which is what makes them worth
    reporting next to the conversions that already happened."""
    return list(
        db.execute(
            select(LeaveRequest)
            .where(
                LeaveRequest.state == "REJECTED_PENDING_WITHDRAWAL",
                LeaveRequest.withdrawal_window_end >= now,
            )
            .order_by(LeaveRequest.withdrawal_window_end.asc())
        ).scalars()
    )


def list_for_report(
    db: Session, *, from_date: date | None = None, to_date: date | None = None, leave_type_id: int | None = None,
    state: str | None = None, employee_id: int | None = None, employee_ids: list[int] | None = None,
    department_id: int | None = None, grade_id: int | None = None,
) -> list[tuple[LeaveRequest, Employee]]:
    """LMS-074/075: filterable leave-taken report. Returns (request, employee)
    pairs since the report needs employee display fields alongside each row."""
    stmt = select(LeaveRequest, Employee).join(Employee, Employee.employee_id == LeaveRequest.employee_id)
    if from_date is not None:
        stmt = stmt.where(LeaveRequest.end_date >= from_date)
    if to_date is not None:
        stmt = stmt.where(LeaveRequest.start_date <= to_date)
    if leave_type_id is not None:
        stmt = stmt.where(LeaveRequest.leave_type_id == leave_type_id)
    if state is not None:
        stmt = stmt.where(LeaveRequest.state == state)
    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)
    if grade_id is not None:
        stmt = stmt.where(Employee.grade_id == grade_id)

    # -1 never matches a real BIGINT id — forces zero rows instead of leaking
    # data when the requested employeeId isn't actually within scope.
    if employee_id is not None:
        allowed = employee_ids is None or employee_id in employee_ids
        stmt = stmt.where(LeaveRequest.employee_id == (employee_id if allowed else -1))
    elif employee_ids is not None:
        stmt = stmt.where(LeaveRequest.employee_id.in_(employee_ids))

    stmt = stmt.order_by(LeaveRequest.start_date.desc())
    return [tuple(row) for row in db.execute(stmt).all()]
