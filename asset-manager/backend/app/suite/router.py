"""Portal -> AMS internal routes (TT Suite contract 3.2). Localhost only: the gateway never proxies
/internal/*. Guarded by the shared INTERNAL_TOKEN; not under /api, so the CSRF check does not apply.
A refusal answers {code, message}; the portal shows the message per app."""
from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult, internal_token_ok

from app.common.config import settings
from app.common.database import get_db
from app.common.exceptions import AppException
from app.suite import service


def internal_only(x_internal_token: str | None = Header(default=None)) -> None:
    if not internal_token_ok(x_internal_token, settings.INTERNAL_TOKEN):
        raise AppException(403, "Internal token missing or wrong.", code="FORBIDDEN")


router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(internal_only)], include_in_schema=False)


@router.post("/provision", response_model=ProvisionResult)
def provision(req: ProvisionRequest, db: Session = Depends(get_db)) -> ProvisionResult:
    try:
        return service.provision(db, req)
    except AppException as exc:
        db.rollback()
        if exc.code is None:  # an AMS rule (e.g. still holds assets): keep its sentence
            exc.code = "REFUSED"
        raise


@router.post("/authorize", response_model=AuthorizeResult)
def authorize(req: AuthorizeRequest, db: Session = Depends(get_db)) -> AuthorizeResult:
    return service.authorize(db, req)
