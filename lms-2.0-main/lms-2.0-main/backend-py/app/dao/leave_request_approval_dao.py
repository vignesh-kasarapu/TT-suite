from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.leave_request import LeaveRequestApproval


def create(db: Session, **fields) -> LeaveRequestApproval:
    row = LeaveRequestApproval(**fields)
    db.add(row)
    db.flush()
    return row


def list_for_request(db: Session, request_id: int) -> list[LeaveRequestApproval]:
    return list(
        db.execute(select(LeaveRequestApproval).where(LeaveRequestApproval.request_id == request_id)).scalars()
    )


def list_stages_for_requests(db: Session, request_ids: list[int]) -> dict[int, list[str]]:
    """Which stages each request has already been approved at, for a whole list in one
    query — the per-request lookup would otherwise run once per row on every list screen."""
    if not request_ids:
        return {}
    rows = db.execute(
        select(LeaveRequestApproval.request_id, LeaveRequestApproval.stage).where(
            LeaveRequestApproval.request_id.in_(request_ids)
        )
    ).all()
    stages: dict[int, list[str]] = {}
    for request_id, stage in rows:
        stages.setdefault(request_id, []).append(stage)
    return stages


def actor_has_approved(db: Session, request_id: int, actor_id: int) -> bool:
    """NFR-13/BR-42: a former approver retains FULL visibility even after the
    request moves past their stage."""
    return (
        db.execute(
            select(LeaveRequestApproval.approval_id).where(
                LeaveRequestApproval.request_id == request_id, LeaveRequestApproval.actor_id == actor_id
            )
        ).first()
        is not None
    )
