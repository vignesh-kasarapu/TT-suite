"""Approver and Finance Reviewer actions, and the Super Inbox (FR-6.9 to 6.11)."""
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.time import now
from app.models import ApprovalStep, Claim, User
from app.models.enums import AdvanceStatus, ClaimStatus, ClaimType, Level, LineStatus, StepStatus
from app.services import audit_service, delegation_service, finance_service, notification_service, routing_service


def _step(db: Session, step_id: int) -> ApprovalStep:
    step = db.get(ApprovalStep, step_id)
    if not step:
        raise HTTPException(404, "Approval item not found.")
    return step


def _ensure_can_act(db: Session, user: User, step: ApprovalStep) -> None:
    if not delegation_service.can_act(db, user, step):
        raise HTTPException(403, "This item is not waiting for you.")


def _record(step: ApprovalStep, user: User, status: str, comment: str | None, amount: Decimal | None = None) -> None:
    step.status = status
    step.acted_by_id = user.id
    step.acted_at = now()
    step.comment = comment
    step.approved_amount = amount
    if step.approver_id and step.approver_id != user.id:
        step.on_behalf_of_id = step.approver_id  # A24


def _audit(db: Session, user: User, step: ApprovalStep, action: str, amount=None, reason=None) -> None:
    audit_service.log(db, user.id, action, "approval_step", step.id, claim_id=step.claim_id, level=step.level,
                      amount=amount, on_behalf_of_id=step.on_behalf_of_id, self_approved=step.claim.self_approved,
                      details={"line_id": step.line_id, "reason": reason} if reason or step.line_id else {})


# ---------- line actions (Level 1 / Level 2) ----------

def approve_line(db: Session, user: User, step_id: int, amount: Decimal | None, comment: str | None) -> Claim:
    step = _step(db, step_id)
    _ensure_can_act(db, user, step)
    if step.level == Level.FINANCE:
        raise HTTPException(400, "Use the finance actions for this item.")
    amount = step.amount if amount is None else amount
    if amount <= 0:
        raise HTTPException(400, "To approve nothing, use Reject line.")
    if amount > step.amount:
        raise HTTPException(400, f"You can only lower the amount (max ₹{step.amount:,.2f}).")
    claim, line = step.claim, step.line
    _record(step, user, StepStatus.APPROVED, comment, amount)
    line.approved_amount = amount
    _audit(db, user, step, "APPROVED", amount)
    if step.level == Level.L1:
        routing_service.after_l1(db, claim, line, amount)
    else:
        line.status = LineStatus.APPROVED
    routing_service.progress(db, claim)
    db.commit()
    return claim


def reject_line(db: Session, user: User, step_id: int, reason: str) -> Claim:
    if not reason.strip():
        raise HTTPException(400, "Give a reason for rejecting this line.")
    step = _step(db, step_id)
    _ensure_can_act(db, user, step)
    if step.level == Level.FINANCE:
        raise HTTPException(400, "Use the finance actions for this item.")
    claim, line = step.claim, step.line
    _record(step, user, StepStatus.REJECTED, reason)
    line.status = LineStatus.REJECTED
    line.reject_reason = reason
    line.approved_amount = Decimal(0)
    _audit(db, user, step, "REJECTED_LINE", reason=reason)
    notification_service.notify(db, claim.employee_id,
                                f"{claim.claim_no}: {line.category.name} line rejected - {reason}", f"/claims/{claim.id}", "RETURNED")
    routing_service.progress(db, claim)
    db.commit()
    return claim


def bulk_approve(db: Session, user: User, step_ids: list[int]) -> dict:
    done, failed = [], []
    for sid in step_ids:
        try:
            step = _step(db, sid)
            if step.level == Level.FINANCE:
                finance_approve(db, user, step.claim_id, None)
            else:
                approve_line(db, user, sid, None, None)
            done.append(sid)
        except HTTPException as e:
            db.rollback()
            failed.append({"step_id": sid, "error": e.detail})
    return {"approved": done, "failed": failed}


def bulk_send_back(db: Session, user: User, claim_ids: list[int], reason: str) -> dict:
    done, failed = [], []
    for cid in dict.fromkeys(claim_ids):
        try:
            send_back(db, user, cid, reason)
            done.append(cid)
        except HTTPException as e:
            db.rollback()
            failed.append({"claim_id": cid, "error": e.detail})
    return {"returned": done, "failed": failed}


# ---------- claim actions ----------

def send_back(db: Session, user: User, claim_id: int, reason: str) -> Claim:
    """FR-2.6: the whole claim returns to the employee and restarts at Level 1 on resubmit."""
    if not reason.strip():
        raise HTTPException(400, "Give a reason for sending this back.")
    claim = db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found.")
    mine = [s for s in claim.steps if s.status == StepStatus.PENDING and delegation_service.can_act(db, user, s)]
    if not mine:
        raise HTTPException(403, "This claim is not waiting for you.")
    for s in claim.steps:
        if s.status == StepStatus.PENDING:
            if s in mine:
                _record(s, user, StepStatus.SENT_BACK, reason)
            else:
                s.status = StepStatus.CANCELLED
    for line in claim.lines:
        line.status = LineStatus.DRAFT
        line.approved_amount = None
    claim.status = ClaimStatus.SENT_BACK
    claim.return_reason = reason
    claim.total_approved = None
    _audit(db, user, mine[0], "SENT_BACK", reason=reason)
    notification_service.notify(db, claim.employee_id, f"{claim.claim_no} was sent back: {reason}", f"/claims/{claim.id}", "RETURNED")
    db.commit()
    return claim


def _finance_step(db: Session, user: User, claim_id: int) -> ApprovalStep:
    claim = db.get(Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found.")
    step = next((s for s in claim.steps if s.level == Level.FINANCE and s.status == StepStatus.PENDING), None)
    if not step:
        raise HTTPException(400, "This claim is not waiting for the finance check.")
    _ensure_can_act(db, user, step)
    return step


def finance_approve(db: Session, user: User, claim_id: int, comment: str | None) -> Claim:
    step = _finance_step(db, user, claim_id)
    claim = step.claim
    _record(step, user, StepStatus.APPROVED, comment, claim.total_approved)
    claim.finance_approved_at = now()
    claim.payment_month = routing_service.payment_month(db)
    claim.status = ClaimStatus.READY_FOR_PAYROLL
    if claim.type == ClaimType.ADVANCE:
        claim.advance_balance = claim.total_approved
        claim.advance_status = AdvanceStatus.OPEN
        claim.payout_amount = claim.total_approved
    else:
        finance_service.apply_advance_deduction(db, claim)
    _audit(db, user, step, "FINANCE_APPROVED", claim.total_approved)
    msg = (f"{claim.claim_no} was fully adjusted against your cash advance." if claim.status == ClaimStatus.PAID
           else f"{claim.claim_no} is approved. ₹{claim.payout_amount:,.2f} will be paid in the {claim.payment_month} payroll.")
    notification_service.notify(db, claim.employee_id, msg, f"/claims/{claim.id}", "APPROVED")
    db.commit()
    return claim


def finance_reject(db: Session, user: User, claim_id: int, reason: str) -> Claim:
    if not reason.strip():
        raise HTTPException(400, "Give a reason for rejecting this claim.")
    step = _finance_step(db, user, claim_id)
    claim = step.claim
    _record(step, user, StepStatus.REJECTED, reason)
    claim.status = ClaimStatus.REJECTED
    claim.return_reason = reason
    _audit(db, user, step, "FINANCE_REJECTED", reason=reason)
    notification_service.notify(db, claim.employee_id, f"{claim.claim_no} was rejected by Finance: {reason}", f"/claims/{claim.id}", "RETURNED")
    db.commit()
    return claim


def clear_duplicate(db: Session, user: User, claim_id: int, line_id: int, reason: str) -> Claim:
    """FR-8.4: an approver or Finance Reviewer clears a false duplicate match with a reason."""
    if not reason.strip():
        raise HTTPException(400, "Give a reason for clearing this match.")
    claim = db.get(Claim, claim_id)
    if not claim or not any(s.status == StepStatus.PENDING and delegation_service.can_act(db, user, s) for s in claim.steps):
        raise HTTPException(403, "This claim is not waiting for you.")
    line = next((l for l in claim.lines if l.id == line_id), None)
    if not line or not line.duplicate_flags:
        raise HTTPException(400, "This line has no duplicate match.")
    line.duplicate_cleared_reason = reason
    audit_service.log(db, user.id, "DUPLICATE_CLEARED", "claim_line", line.id, claim_id=claim.id, details={"reason": reason})
    db.commit()
    return claim


# ---------- inbox ----------

def inbox(db: Session, user: User) -> list[ApprovalStep]:
    """All pending steps this user can act on today, risky first (FR-6.9)."""
    steps = db.scalars(
        select(ApprovalStep)
        .where(ApprovalStep.status == StepStatus.PENDING, delegation_service.candidate_step_filter(db, user))
        .options(selectinload(ApprovalStep.claim).selectinload(Claim.lines), selectinload(ApprovalStep.line))
    ).all()
    mine = [s for s in steps if delegation_service.can_act(db, user, s)]

    def risk(s: ApprovalStep) -> int:
        lines = [s.line] if s.line else s.claim.lines
        score = sum(len(l.policy_flags) + (0 if l.duplicate_cleared_reason else len(l.duplicate_flags)) for l in lines)
        return score + (1 if s.claim.self_approved else 0)

    return sorted(mine, key=lambda s: (-risk(s), -(s.amount or 0), s.activated_at))
