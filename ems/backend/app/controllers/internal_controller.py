"""Portal -> EMS internal routes (TT Suite contract 3.2). Localhost only: the gateway never proxies /internal/*.
Guarded by the shared INTERNAL_TOKEN; not under /api, so the CSRF header check does not apply."""
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult, internal_token_ok

from app.core.config import settings
from app.core.db import get_db
from app.services import provision_service


def internal_only(x_internal_token: str | None = Header(default=None)) -> None:
    if not internal_token_ok(x_internal_token, settings.internal_token):
        raise HTTPException(403, {"code": "FORBIDDEN", "detail": "Internal token missing or wrong."})


router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(internal_only)], include_in_schema=False)


def _as_refusal(e: HTTPException) -> HTTPException:
    """Service errors carry a sentence; the portal wants {"code", "detail"}."""
    if isinstance(e.detail, dict) and "code" in e.detail:
        return e
    return provision_service.refuse(e.status_code, "REFUSED", str(e.detail))


@router.post("/provision", response_model=ProvisionResult)
def provision(req: ProvisionRequest, db: Session = Depends(get_db)):
    try:
        return provision_service.provision(db, req)
    except HTTPException as e:
        db.rollback()
        raise _as_refusal(e) from None


@router.post("/authorize", response_model=AuthorizeResult)
def authorize(req: AuthorizeRequest, db: Session = Depends(get_db)):
    return provision_service.authorize(db, req)
