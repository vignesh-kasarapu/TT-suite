"""Portal -> LMS internal contract (TT Suite contract §3.2). Mounted at /internal on the
app root (not under /api, so the gateway never proxies it), guarded by the shared
`x-internal-token` header, exempt from the CSRF header check, never rate-limited.

Refusals answer 4xx `{"code", "detail"}` (the suite's InternalError shape), not the
LMS `{success, error}` envelope.
"""
from datetime import date

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from suite_core.constants import INTERNAL_HEADER
from suite_core.provision import AuthorizeRequest, AuthorizeResult, ProvisionRequest, ProvisionResult, internal_token_ok

from app.core.config import settings
from app.core.db import get_db
from app.core.exceptions import AppError
from app.services import days_off_service, suite_provision_service


class InternalRefusal(Exception):
    def __init__(self, status: int, code: str, detail: str):
        self.status, self.code, self.detail = status, code, detail


def require_internal_token(request: Request) -> None:
    if not internal_token_ok(request.headers.get(INTERNAL_HEADER), settings.internal_token):
        raise InternalRefusal(401, "BAD_INTERNAL_TOKEN", "Missing or wrong internal token.")


router = APIRouter(dependencies=[Depends(require_internal_token)])


def _refusal(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


@router.post("/provision", response_model=ProvisionResult)
def provision(req: ProvisionRequest, db: Session = Depends(get_db)):
    try:
        return suite_provision_service.provision(db, req)
    except AppError as exc:
        return _refusal(exc.status if 400 <= exc.status < 500 else 409, exc.code, exc.message)


@router.post("/authorize", response_model=AuthorizeResult)
def authorize(req: AuthorizeRequest, db: Session = Depends(get_db)):
    try:
        return suite_provision_service.authorize(db, req)
    except AppError as exc:
        return _refusal(exc.status if 400 <= exc.status < 500 else 409, exc.code, exc.message)


class DaysOffRequest(BaseModel):
    """Which people, and over which dates. Ids are TT Suite user ids (`app.users.id`)."""

    suite_user_ids: list[str] = Field(default_factory=list, alias="suiteUserIds")
    start: date
    end: date

    model_config = ConfigDict(populate_by_name=True)


class DayOffOut(BaseModel):
    suite_user_id: str = Field(serialization_alias="suiteUserId")
    date: date
    #: "leave" or "holiday".
    kind: str
    label: str
    #: 1.0 for a whole day, 0.5 when only half the day is leave.
    portion: float

    model_config = ConfigDict(populate_by_name=True)


class DaysOffResult(BaseModel):
    days: list[DayOffOut]


@router.post("/days-off", response_model=DaysOffResult)
def days_off(req: DaysOffRequest, db: Session = Depends(get_db)):
    """The days these people are not working: approved leave and the holidays that apply to
    them. Used by Kanban's time log, so somebody on leave is not asked to account for the
    day, and so nobody tells two applications the same thing twice.

    A person LMS has never heard of simply has no days off; that is not an error.
    """
    if req.end < req.start:
        return _refusal(400, "BAD_RANGE", "end must not be before start.")
    if len(req.suite_user_ids) > 500:
        return _refusal(400, "TOO_MANY_USERS", "Ask about at most 500 people at a time.")
    rows = days_off_service.days_off_for_suite_users(db, req.suite_user_ids, req.start, req.end)
    return DaysOffResult(days=[DayOffOut(**row) for row in rows])


def register_internal_error_handler(app) -> None:
    @app.exception_handler(InternalRefusal)
    async def _handle(_request: Request, exc: InternalRefusal):
        return _refusal(exc.status, exc.code, exc.detail)
