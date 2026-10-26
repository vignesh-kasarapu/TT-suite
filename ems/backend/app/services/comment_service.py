"""Comments on a claim: anyone who can see the claim can write; everyone involved is notified."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Claim, ClaimComment, User
from app.services import audit_service, claim_service, delegation_service, notification_service


def add(db: Session, user: User, claim_id: int, body: str) -> Claim:
    claim = claim_service.get_visible(db, user, claim_id)
    body = body.strip()
    if not body:
        raise HTTPException(400, "Write a comment first.")
    db.add(ClaimComment(claim_id=claim.id, author_id=user.id, body=body))
    audit_service.log(db, user.id, "COMMENTED", "claim", claim.id, claim_id=claim.id)

    people = {claim.employee_id}
    for s in claim.steps:
        people.update(x for x in (s.acted_by_id, s.on_behalf_of_id) if x)
        if s.status == "PENDING" and s.approver_id:
            people.add(delegation_service.effective_approver_id(db, s, claim))
    people.update(c.author_id for c in claim.comments)
    people.discard(user.id)
    for pid in people:
        notification_service.notify(db, pid, f"{user.full_name} commented on {claim.claim_no}: {body[:80]}",
                                    f"/claims/{claim.id}", "COMMENT")
    db.commit()
    db.refresh(claim)
    return claim
