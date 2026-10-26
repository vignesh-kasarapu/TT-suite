"""Mirrors backend/src/services/approvalRouting.service.js — full port
(Phase 2 only carried the circular-hierarchy check; the rest lands here
alongside Phase 3's leave_request_service)."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import delegation_dao, employee_dao, role_dao


def would_create_circular_hierarchy(db: Session, employee_id: int | None, proposed_manager_id: int) -> bool:
    """BR-37: walks reporting_manager_id upward from proposed_manager_id; True if
    it reaches employee_id or revisits an already-seen node (pre-existing cycle
    defense, matches the Node original exactly)."""
    seen: set[int] = set()
    current_id: int | None = proposed_manager_id
    while current_id is not None:
        if current_id == employee_id or current_id in seen:
            return True
        seen.add(current_id)
        current = employee_dao.find_by_id(db, current_id)
        current_id = current.reporting_manager_id if current else None
    return False


def assert_not_self_approval(actor_id: int, subject_employee_id: int) -> None:
    """Role assignment rule: self-approval is prohibited in any capacity,
    including as delegate/HR."""
    if actor_id == subject_employee_id:
        raise AppError("SELF_APPROVAL_BLOCKED", "You may not approve or reject your own leave request.", status=403)


@dataclass
class FirstStageApprover:
    approver_id: int | None
    on_behalf_of_id: int | None


def get_first_stage_approver(db: Session, employee, on_date: date | None = None) -> FirstStageApprover | None:
    """BR-22: first-stage approver is the employee's Manager, or that Manager's
    active Delegate."""
    manager_id = employee.reporting_manager_id
    if manager_id is None:
        return None
    on_date = on_date or datetime.now().date()
    delegation = delegation_dao.find_active_for_nominator(db, manager_id, on_date)
    if delegation is not None:
        return FirstStageApprover(approver_id=delegation.delegate_id, on_behalf_of_id=manager_id)
    return FirstStageApprover(approver_id=manager_id, on_behalf_of_id=None)


def get_contiguous_aggregate_days(
    db: Session, employee_id: int, leave_type_id: int, candidate_start: date, candidate_end: date,
    sick_only: bool = False, leave_year_id: int | None = None,
) -> float:
    """BR-24: aggregate contiguous requests (zero deducted working days apart),
    Pending/Approved only, to decide whether the long-leave (BR-23) or
    sick-leave (BR-43/44) threshold is crossed. Sick-type days only aggregate
    with Sick-type days (BR-44). "Zero deducted working days apart" means the
    gap between two spans contains no day that would itself count as a
    deducted working day for this employee — not merely that the two date
    ranges overlap, which would miss e.g. two 5-day spans separated by a
    single weekend."""
    from app.dao import leave_request_dao
    from app.services import business_day_service

    candidates = leave_request_dao.find_aggregate_candidates(
        db, employee_id, leave_type_id if sick_only else None
    )

    total = 0.0
    for r in candidates:
        overlaps = r.end_date >= candidate_start and r.start_date <= candidate_end
        is_contiguous = overlaps
        if not overlaps and leave_year_id is not None:
            gap_start = min(r.end_date, candidate_end) + timedelta(days=1)
            gap_end = max(r.start_date, candidate_start) - timedelta(days=1)
            if gap_start > gap_end:
                is_contiguous = True
            else:
                gap_breakdown = business_day_service.compute_deduction_breakdown(
                    db, gap_start, gap_end, False, leave_year_id, employee_id
                )
                is_contiguous = gap_breakdown["deducted_working_days"] == 0
        if is_contiguous:
            total += float(r.deducted_days or 0)
    return total


def requires_long_leave_second_stage(db: Session, deducted_days: float, aggregate_days: float) -> bool:
    """BR-23: does this request (post-aggregation) require HR/Admin
    second-stage approval? aggregate_days is the sum of OTHER contiguous
    requests (never this candidate's own days), so the two must be added
    together — taking the max would let two individually-under-threshold
    requests combine to exceed it without ever being detected."""
    from app.services import config_service

    threshold = config_service.get(db, "approval.long_leave_threshold_days")
    return (deducted_days + aggregate_days) > threshold


def is_eligible_for_self_approval(db: Session, employee, on_date: date | None = None) -> bool:
    """R1 Addendum (table 37): controlled self-approval. Grants only apply
    when the employee has an active grant AND no valid higher authority
    exists — no reporting manager on record."""
    from app.dao import self_approval_dao

    on_date = on_date or datetime.now().date()
    grant = self_approval_dao.find_active(db, employee.employee_id, on_date)
    if grant is None:
        return False
    has_higher_authority = employee.reporting_manager_id is not None
    return not has_higher_authority


def has_role(db: Session, employee_id: int, role_code: str) -> bool:
    return role_dao.has_role(db, employee_id, role_code)
