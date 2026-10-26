"""Thin — mirrors backend/src/routes/delegation.routes.js +
delegation.controller.js."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.dao import employee_dao
from app.schemas.delegation import (
    DelegateCandidateOut,
    DelegationOut,
    DelegationWithNamesOut,
    EligibleDelegatesOut,
    NominateIn,
    NominateOnBehalfIn,
)
from app.services import delegation_service

router = APIRouter()


def _candidate_out(employee) -> dict:
    return DelegateCandidateOut.model_validate(employee).model_dump()


@router.get("/eligible")
def eligible_delegates(db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER"))):
    result = delegation_service.get_eligible_delegates(db, user.employee_id)
    return ok(EligibleDelegatesOut(candidates=[_candidate_out(c) for c in result["candidates"]], fallback_used=result["fallback_used"]).model_dump(by_alias=True))


@router.get("/managers")
def managers(db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    rows = delegation_service.list_managers(db)
    return ok([_candidate_out(m) for m in rows])


@router.get("/eligible-for/{nominator_id}")
def eligible_for_manager(nominator_id: int, db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    rows = delegation_service.get_eligible_peer_managers(db, nominator_id)
    return ok([_candidate_out(m) for m in rows])


@router.get("/mine")
def mine(db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER"))):
    rows = delegation_service.list_mine(db, user.employee_id)
    return ok([_enrich(db, d) for d in rows])


@router.get("")
def list_all(db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    rows = delegation_service.list_all(db)
    return ok([_enrich(db, d) for d in rows])


@router.post("", status_code=201)
def create(payload: NominateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER"))):
    delegation = delegation_service.nominate(db, user.employee_id, payload.delegate_id, payload.from_date, payload.to_date, user.employee_id)
    return created(DelegationOut.model_validate(delegation).model_dump())


@router.post("/on-behalf", status_code=201)
def create_on_behalf(payload: NominateOnBehalfIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER"))):
    delegation = delegation_service.nominate_on_behalf(
        db, user.employee_id, payload.nominator_id, payload.delegate_id, payload.from_date, payload.to_date,
        is_hr_admin="HR_ADMIN" in user.roles,
    )
    return created(DelegationOut.model_validate(delegation).model_dump())


@router.post("/{delegation_id}/revoke")
def revoke(delegation_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("MANAGER"))):
    delegation = delegation_service.revoke(db, delegation_id, user.employee_id, actor_is_hr_admin="HR_ADMIN" in user.roles)
    return ok(DelegationOut.model_validate(delegation).model_dump())


def _enrich(db: Session, delegation) -> dict:
    nominator = employee_dao.find_by_id(db, delegation.nominator_id)
    delegate = employee_dao.find_by_id(db, delegation.delegate_id)
    return DelegationWithNamesOut(
        **DelegationOut.model_validate(delegation).model_dump(),
        nominator_name=nominator.full_name if nominator else None,
        delegate_name=delegate.full_name if delegate else None,
    ).model_dump()
