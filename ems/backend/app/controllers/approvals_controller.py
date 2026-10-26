from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import current_user
from app.models import User
from app.schemas.claim import ClaimDetail
from app.schemas.common import ReasonIn
from app.schemas.presenters import claim_detail
from app.schemas.workflow import ApproveIn, BulkIn, BulkReturnIn, InboxItem
from app.services import approval_service, routing_service

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


def _prev(s) -> dict:
    """Who approved the step before this one (Level 1 for a Level 2 item)."""
    if s.level != "L2" or not s.line_id:
        return {}
    prev = [p for p in s.claim.steps if p.line_id == s.line_id and p.level == "L1" and p.round == s.round
            and p.status == "APPROVED" and p.acted_by]
    if not prev:
        return {}
    return {"prev_approval": prev[-1].acted_by.full_name, "prev_approved_at": prev[-1].acted_at}


def _next_step(s) -> str:
    if s.level == "FINANCE":
        return "Payroll"
    if s.level == "L1" and s.line and routing_service.find_l2(s.line.l2_rules, s.amount):
        return "Level 2"
    return "Finance"


@router.get("/inbox", response_model=list[InboxItem])
def inbox(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = []
    for s in approval_service.inbox(db, user):
        c, line = s.claim, s.line
        lines = [line] if line else c.lines
        flags = [f["message"] for l in lines for f in l.policy_flags]
        flags += [f["message"] for l in lines if not l.duplicate_cleared_reason for f in l.duplicate_flags]
        items.append(InboxItem(
            step_id=s.id, level=s.level, claim_id=c.id, claim_no=c.claim_no, claim_type=c.type, title=c.title,
            employee=c.employee, line_id=s.line_id, category_name=line.category.name if line else None,
            expense_date=line.expense_date if line else None, merchant=line.merchant if line else None,
            amount=s.amount, flags=flags, self_approved=c.self_approved,
            on_behalf_of=s.approver.full_name if s.approver and s.approver_id != user.id else None,
            next_step=_next_step(s),
            line_count=len(c.lines),
            **_prev(s),
            waiting_since=s.activated_at,
        ))
    return items


@router.post("/steps/{step_id}/approve", response_model=ClaimDetail)
def approve(step_id: int, data: ApproveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, approval_service.approve_line(db, user, step_id, data.amount, data.comment))


@router.post("/steps/{step_id}/reject", response_model=ClaimDetail)
def reject_line(step_id: int, data: ReasonIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, approval_service.reject_line(db, user, step_id, data.reason))


@router.post("/bulk-approve")
def bulk_approve(data: BulkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return approval_service.bulk_approve(db, user, data.step_ids)


@router.post("/bulk-send-back")
def bulk_send_back(data: BulkReturnIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return approval_service.bulk_send_back(db, user, data.claim_ids, data.reason)


@router.post("/claims/{claim_id}/send-back", response_model=ClaimDetail)
def send_back(claim_id: int, data: ReasonIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, approval_service.send_back(db, user, claim_id, data.reason))


@router.post("/claims/{claim_id}/finance-approve", response_model=ClaimDetail)
def finance_approve(claim_id: int, data: ApproveIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, approval_service.finance_approve(db, user, claim_id, data.comment))


@router.post("/claims/{claim_id}/finance-reject", response_model=ClaimDetail)
def finance_reject(claim_id: int, data: ReasonIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, approval_service.finance_reject(db, user, claim_id, data.reason))


@router.post("/claims/{claim_id}/lines/{line_id}/clear-duplicate", response_model=ClaimDetail)
def clear_duplicate(claim_id: int, line_id: int, data: ReasonIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return claim_detail(db, user, approval_service.clear_duplicate(db, user, claim_id, line_id, data.reason))
