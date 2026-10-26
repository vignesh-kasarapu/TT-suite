"""Delegation = full handover (A21-A26).

Steps keep the original approver in approver_id. Who may act is resolved at read time, so a
delegation starting later or ending early moves pending work automatically, with no data rewrite.
"""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.time import now, today
from app.models import ApprovalStep, Claim, Delegation, User
from app.models.enums import Level, Role
from app.services import audit_service, notification_service, settings_service

HANDOVER_ROLES = (Role.APPROVER, Role.FINANCE)


def active_delegation(db: Session, user_id: int, on: date | None = None) -> Delegation | None:
    on = on or today()
    return db.scalars(
        select(Delegation).where(
            Delegation.delegator_id == user_id,
            Delegation.cancelled_at.is_(None),
            Delegation.start_date <= on,
            Delegation.end_date >= on,
        )
    ).first()


def effective_approver_id(db: Session, step: ApprovalStep, claim: Claim) -> int | None:
    """The one person who can act on this step today. None = Finance pool or unassigned."""
    if step.approver_id is None:
        return None
    d = active_delegation(db, step.approver_id)
    if not d:
        return step.approver_id
    if d.delegate_id == claim.employee_id:  # A25: delegate never approves their own claim
        delegate = db.get(User, d.delegate_id)
        return delegate.manager_id if delegate and delegate.manager_id else step.approver_id
    return d.delegate_id  # A26: no chaining, the delegate's own delegation is not followed


def finance_pool_allows(db: Session, user: User, claim: Claim) -> bool:
    """Unassigned FINANCE step: any Finance Reviewer except the submitter. Claims of Finance
    Reviewers never use the pool; they go to the named Finance Backup Reviewer (FR-3.9)."""
    return Role.FINANCE in user.roles and user.id != claim.employee_id and Role.FINANCE not in claim.employee.roles


def can_act(db: Session, user: User, step: ApprovalStep) -> bool:
    if step.status != "PENDING":
        return False
    claim = step.claim
    if step.level == Level.FINANCE:
        if step.approver_id is None:
            return finance_pool_allows(db, user, claim)
        return Role.FINANCE in user.roles and effective_approver_id(db, step, claim) == user.id
    return effective_approver_id(db, step, claim) == user.id


def list_for(db: Session, user: User) -> dict:
    mine = db.scalars(select(Delegation).where(Delegation.delegator_id == user.id).order_by(Delegation.start_date.desc())).all()
    to_me = db.scalars(select(Delegation).where(Delegation.delegate_id == user.id).order_by(Delegation.start_date.desc())).all()
    return {"given": list(mine), "received": list(to_me)}


def create(db: Session, user: User, delegate_id: int, start: date, end: date, reason: str) -> Delegation:
    my_roles = [r for r in HANDOVER_ROLES if r in user.roles]
    if not my_roles:
        raise HTTPException(400, "Only Approvers and Finance Reviewers can delegate.")
    if end < start:
        raise HTTPException(400, "The end date must be on or after the start date.")
    if end < today():
        raise HTTPException(400, "The dates are in the past.")
    delegate = db.get(User, delegate_id)
    if not delegate or not delegate.is_active or delegate.id == user.id:
        raise HTTPException(400, "Choose another active person as your delegate.")
    missing = [r for r in my_roles if r not in delegate.roles]
    if missing:  # A22: same role
        names = {"APPROVER": "Manager", "FINANCE": "Finance Reviewer"}
        raise HTTPException(400, f"{delegate.full_name} must also hold the {', '.join(names[r] for r in missing)} role.")
    overlap = db.scalars(
        select(Delegation).where(
            Delegation.delegator_id == user.id,
            Delegation.cancelled_at.is_(None),
            Delegation.start_date <= end,
            Delegation.end_date >= start,
        )
    ).first()
    if overlap:
        raise HTTPException(400, "You already have a delegation in these dates. Cancel it first.")
    d = Delegation(delegator_id=user.id, delegate_id=delegate.id, start_date=start, end_date=end, reason=reason)
    db.add(d)
    db.flush()
    audit_service.log(db, user.id, "DELEGATION_CREATED", "delegation", d.id,
                      details={"delegate": delegate.full_name, "start": start, "end": end})
    notification_service.notify(
        db, delegate.id,
        f"{user.full_name} handed over their approvals to you from {start:%d %b %Y} to {end:%d %b %Y}.",
        "/approvals",
    )
    _warn_finance_backup(db, user, start, end)
    db.commit()
    return d


def cancel(db: Session, user: User, delegation_id: int) -> None:
    d = db.get(Delegation, delegation_id)
    if not d or d.delegator_id != user.id or d.cancelled_at:
        raise HTTPException(404, "Delegation not found.")
    d.cancelled_at = now()
    audit_service.log(db, user.id, "DELEGATION_CANCELLED", "delegation", d.id)
    notification_service.notify(db, d.delegate_id, f"{user.full_name} ended their delegation to you.", "/approvals")
    db.commit()


def _warn_finance_backup(db: Session, user: User, start: date, end: date) -> None:
    if user.id == settings_service.get(db, "finance_backup_reviewer_id"):
        audit_service.log(db, user.id, "FINANCE_BACKUP_ON_LEAVE", "delegation", user.id, details={"start": start, "end": end})


def delegators_to(db: Session, user_id: int) -> list[int]:
    """People whose work is handed to user_id today."""
    t = today()
    return list(
        db.scalars(
            select(Delegation.delegator_id).where(
                Delegation.delegate_id == user_id,
                Delegation.cancelled_at.is_(None),
                Delegation.start_date <= t,
                Delegation.end_date >= t,
            )
        )
    )


def candidate_step_filter(db: Session, user: User):
    """SQL pre-filter for inbox queries; can_act() makes the final call."""
    ids = [user.id, *delegators_to(db, user.id)]
    # A25 fallback: a delegate's own claim goes to the delegate's manager, so include my reports' delegators
    reports = db.scalars(select(User.id).where(User.manager_id == user.id)).all()
    for r in reports:
        ids.extend(delegators_to(db, r))
    conds = [ApprovalStep.approver_id.in_(ids)]
    if Role.FINANCE in user.roles:
        conds.append(ApprovalStep.approver_id.is_(None) & (ApprovalStep.level == Level.FINANCE))
    return or_(*conds)
