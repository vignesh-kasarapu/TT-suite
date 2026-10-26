from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import current_user
from app.core.time import today
from app.models import Delegation, User
from app.schemas.workflow import DelegationIn, DelegationOut
from app.services import delegation_service

router = APIRouter(prefix="/api/delegations", tags=["delegations"])


def _out(d: Delegation) -> DelegationOut:
    out = DelegationOut.model_validate(d)
    out.is_active_now = d.cancelled_at is None and d.start_date <= today() <= d.end_date
    return out


@router.get("")
def list_delegations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    data = delegation_service.list_for(db, user)
    return {k: [_out(d) for d in v] for k, v in data.items()}


@router.post("", response_model=DelegationOut)
def create(data: DelegationIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(delegation_service.create(db, user, data.delegate_id, data.start_date, data.end_date, data.reason))


@router.post("/{delegation_id}/cancel", status_code=204)
def cancel(delegation_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    delegation_service.cancel(db, user, delegation_id)
