"""Turn ORM objects into the view models the browser receives."""
from sqlalchemy.orm import Session

from app.models import Claim, User
from app.models.enums import ClaimStatus, Level, Role, StepStatus
from app.schemas.claim import ClaimDetail, CommentOut, LineOut, StepOut
from app.services import delegation_service

LEVEL_NAMES = {Level.L1: "Level 1", Level.L2: "Level 2", Level.FINANCE: "Finance"}


def _name(db: Session, user_id: int | None) -> str | None:
    if user_id is None:
        return None
    u = db.get(User, user_id)
    return u.full_name if u else None


def claim_detail(db: Session, viewer: User, claim: Claim) -> ClaimDetail:
    steps, waiting, mine = [], [], []
    for s in claim.steps:
        current = None
        if s.status == StepStatus.PENDING:
            if s.level == Level.FINANCE and s.approver_id is None:
                current = "Any Finance Reviewer" if Role.FINANCE not in claim.employee.roles else "Unassigned (Admin alerted)"
            elif s.approver_id is None:
                current = "Unassigned (Admin alerted)"
            else:
                current = _name(db, delegation_service.effective_approver_id(db, s, claim))
                if current and s.approver_id and delegation_service.effective_approver_id(db, s, claim) != s.approver_id:
                    current = f"{current} (for {_name(db, s.approver_id)})"
            waiting.append(f"{LEVEL_NAMES[s.level]} - {current}")
            if delegation_service.can_act(db, viewer, s):
                mine.append(s.id)
        steps.append(StepOut(
            id=s.id, line_id=s.line_id, round=s.round, level=s.level, status=s.status,
            approver_name=_name(db, s.approver_id), current_approver_name=current, amount=s.amount,
            approved_amount=s.approved_amount, acted_by_name=_name(db, s.acted_by_id),
            on_behalf_of_name=_name(db, s.on_behalf_of_id), acted_at=s.acted_at, comment=s.comment,
            self_approved=s.self_approved, escalated=s.escalated, activated_at=s.activated_at,
        ))
    lines = [LineOut.model_validate({**{c: getattr(l, c) for c in LineOut.model_fields if c != "category_name"},
                                     "category_name": l.category.name}) for l in claim.lines]
    base = {f: getattr(claim, f) for f in ClaimDetail.model_fields
            if f not in ("lines", "steps", "waiting_on_steps", "my_step_ids", "can_edit", "can_finance_act", "can_reassign",
                         "comments", "can_withdraw")}
    finance_pending = any(s.level == Level.FINANCE for s in claim.steps if s.id in mine)
    return ClaimDetail.model_validate(dict(
        **base, lines=lines, steps=steps, waiting_on_steps=list(dict.fromkeys(waiting)), my_step_ids=mine,
        comments=[CommentOut(id=c.id, author_id=c.author_id, author_name=c.author.full_name, body=c.body, created_at=c.created_at)
                  for c in claim.comments],
        can_withdraw=claim.employee_id == viewer.id and claim.status in (ClaimStatus.PENDING_APPROVAL, ClaimStatus.PENDING_FINANCE),
        can_edit=claim.employee_id == viewer.id and claim.status in ClaimStatus.EDITABLE,
        can_finance_act=finance_pending,
        can_reassign=Role.ADMIN in viewer.roles and any(s.status == StepStatus.PENDING for s in claim.steps),
    ), from_attributes=True)
