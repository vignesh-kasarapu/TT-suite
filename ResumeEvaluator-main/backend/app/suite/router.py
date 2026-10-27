"""Portal -> Resume Evaluator internal routes (TT Suite contract 3.2). Localhost only: the gateway never
proxies /internal/*. Guarded by the shared INTERNAL_TOKEN; not under /api, so the CSRF check does
not apply. A refusal answers {code, detail}; the portal shows the detail per app."""
from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult, internal_token_ok

from app.config import settings
from app.deps import get_db
from app.suite import service
from app.suite.service import SuiteError


def internal_only(x_internal_token: str | None = Header(default=None)) -> None:
    if not internal_token_ok(x_internal_token, settings.internal_token):
        raise SuiteError(403, "FORBIDDEN", "Internal token missing or wrong.")


router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(internal_only)], include_in_schema=False)


@router.post("/provision", response_model=ProvisionResult)
def provision(req: ProvisionRequest, db: Session = Depends(get_db)) -> ProvisionResult:
    try:
        return service.provision(db, req)
    except SuiteError:
        db.rollback()
        raise


@router.post("/authorize", response_model=AuthorizeResult)
def authorize(req: AuthorizeRequest, db: Session = Depends(get_db)) -> AuthorizeResult:
    return service.authorize(db, req)
