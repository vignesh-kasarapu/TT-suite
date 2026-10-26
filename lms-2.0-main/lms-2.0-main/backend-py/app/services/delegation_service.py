"""Mirrors backend/src/services/delegation.service.js (LMS-041/042)."""
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import delegation_dao, employee_dao
from app.services import approval_routing_service, audit_service, notification_service


def _candidate_peers(db: Session, nominator) -> list:
    all_active = employee_dao.list_active(db)
    peers = [
        e for e in all_active
        if e.employee_id != nominator.employee_id
        and e.reporting_manager_id == nominator.reporting_manager_id
        and e.management_level_id == nominator.management_level_id
    ]
    return [p for p in peers if approval_routing_service.has_role(db, p.employee_id, "MANAGER")]


def get_eligible_delegates(db: Session, nominator_id: int) -> dict:
    """LMS-041: eligible delegates are peer Managers under the same
    supervisor. Where no peer exists, falls back to the nominating Manager's
    own supervisor."""
    nominator = employee_dao.find_by_id(db, nominator_id)
    if nominator is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)

    peer_managers = _candidate_peers(db, nominator)
    if peer_managers:
        return {"candidates": peer_managers, "fallback_used": False}

    if nominator.reporting_manager_id:
        supervisor = employee_dao.find_by_id(db, nominator.reporting_manager_id)
        return {"candidates": [supervisor] if supervisor else [], "fallback_used": True}
    return {"candidates": [], "fallback_used": True}


def get_eligible_peer_managers(db: Session, nominator_id: int) -> list:
    """HR/Admin picker: only same-supervisor, same-level Managers — no
    supervisor fallback."""
    nominator = employee_dao.find_by_id(db, nominator_id)
    if nominator is None:
        raise AppError("NOT_FOUND", "Manager not found.", status=404)
    if nominator.management_level_id is None:
        return []
    return sorted(_candidate_peers(db, nominator), key=lambda e: (e.first_name or "", e.last_name or ""))


def list_managers(db: Session) -> list:
    all_active = employee_dao.list_active(db)
    managers = [e for e in all_active if approval_routing_service.has_role(db, e.employee_id, "MANAGER")]
    return sorted(managers, key=lambda e: (e.first_name or "", e.last_name or ""))


def _assert_no_overlap(db: Session, nominator_id: int, from_date: date, to_date: date) -> None:
    """getFirstStageApprover picks a single active delegation via a
    date-range lookup with no tie-break — overlapping windows would make
    routing non-deterministic."""
    existing = delegation_dao.list_active_for_nominator(db, nominator_id)
    overlaps = any(from_date <= d.to_date and to_date >= d.from_date for d in existing)
    if overlaps:
        raise AppError(
            "DELEGATION_OVERLAP",
            "This manager already has an active delegation covering part of this date range. "
            "Delegation windows may not overlap.",
        )


def nominate(db: Session, nominator_id: int, delegate_id: int, from_date: date, to_date: date, set_by_id: int, allow_fallback: bool = True):
    """LMS-041: a Manager nominates a Delegate for a defined date range, from
    the eligible list only."""
    candidates = (
        get_eligible_delegates(db, nominator_id)["candidates"] if allow_fallback else get_eligible_peer_managers(db, nominator_id)
    )
    if not any(c.employee_id == delegate_id for c in candidates):
        raise AppError(
            "INELIGIBLE_DELEGATE",
            "This employee is not an eligible delegate (must be a peer manager under the same supervisor, "
            "or the supervisor where no peer exists).",
        )
    _assert_no_overlap(db, nominator_id, from_date, to_date)

    delegation = delegation_dao.create(db, nominator_id=nominator_id, delegate_id=delegate_id, set_by_id=set_by_id, from_date=from_date, to_date=to_date)
    audit_service.record(
        db, action="DELEGATION_CREATED", entity_type="delegations", entity_id=delegation.delegation_id, actor_id=set_by_id,
        new_value={"nominator_id": nominator_id, "delegate_id": delegate_id, "from_date": from_date, "to_date": to_date},
    )
    # LMS-041/042: both the Manager and the Delegate are notified.
    notification_service.notify(db, recipient_id=nominator_id, template_key="DELEGATE_ASSIGNED_TO_YOU", tokens={"nominatorId": nominator_id, "delegateId": delegate_id})
    notification_service.notify(db, recipient_id=delegate_id, template_key="DELEGATE_ASSIGNED_TO_YOU", tokens={"nominatorId": nominator_id, "delegateId": delegate_id})
    db.commit()
    return delegation


def nominate_on_behalf(db: Session, supervisor_id: int, nominator_id: int, delegate_id: int, from_date: date, to_date: date, is_hr_admin: bool = False):
    """LMS-042: a Manager's own supervisor may set a delegate on that
    Manager's behalf, for emergency cover."""
    nominator = employee_dao.find_by_id(db, nominator_id)
    if nominator is None:
        raise AppError("NOT_FOUND", "Manager not found.", status=404)
    if not is_hr_admin and nominator.reporting_manager_id != supervisor_id:
        raise AppError("NOT_SUPERVISOR", "You may only set a delegation for your own direct reports.", status=403)
    return nominate(db, nominator_id, delegate_id, from_date, to_date, supervisor_id, allow_fallback=not is_hr_admin)


def revoke(db: Session, delegation_id: int, actor_id: int, actor_is_hr_admin: bool = False):
    delegation = delegation_dao.find_by_id(db, delegation_id)
    if delegation is None:
        raise AppError("NOT_FOUND", "Delegation not found.", status=404)

    is_owner = delegation.nominator_id == actor_id or delegation.set_by_id == actor_id
    if not is_owner and not actor_is_hr_admin:
        raise AppError("NOT_OWNER", "You can only revoke a delegation you nominated or set on someone else's behalf.", status=403)

    from datetime import datetime, timezone

    delegation.revoked_at = datetime.now(timezone.utc)
    delegation_dao.save(db, delegation)
    audit_service.record(db, action="DELEGATION_REVOKED", entity_type="delegations", entity_id=delegation_id, actor_id=actor_id)
    return delegation


def list_mine(db: Session, employee_id: int) -> list:
    return delegation_dao.list_mine(db, employee_id)


def list_all(db: Session) -> list:
    """Roles doc Section 2.6: "HR/Admin: R Org (optional visibility)" — every
    delegation, not just the caller's own."""
    return delegation_dao.list_all(db)
