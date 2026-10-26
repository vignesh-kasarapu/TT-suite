"""internal: the portal -> Kanban calls (TT Suite SUITE-CONTRACT §3.2).

Mounted at the app root (`/internal/*`), never under `/api`: the portal gateway never proxies
it, so it is reachable on localhost only. Every call needs `x-internal-token` equal to
`INTERNAL_TOKEN` (empty refuses all). Outside the public contract: no x-roles, not in the
OpenAPI document, not CSRF-checked (not `/api/`) and never rate-limited (pipeline.py).
Bodies and results are suite_core's models (snake_case), as the portal sends them.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header
from suite_core.constants import INTERNAL_HEADER
from suite_core.provision import (
    AuthorizeRequest,
    AuthorizeResult,
    ProvisionRequest,
    ProvisionResult,
    internal_token_ok,
)

from app.core.config import Settings
from app.dependencies.database import get_settings
from app.dependencies.services import get_suite_service
from app.exceptions.custom_exceptions import InternalTokenException
from app.services.suite_service import SuiteService


def require_internal_token(
    token: Annotated[str | None, Header(alias=INTERNAL_HEADER)] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    if not internal_token_ok(token, settings.INTERNAL_TOKEN):
        raise InternalTokenException()


router = APIRouter(
    prefix="/internal",
    tags=["internal"],
    include_in_schema=False,
    dependencies=[Depends(require_internal_token)],
)


@router.post("/provision", response_model=ProvisionResult)
async def provision(
    body: ProvisionRequest, service: SuiteService = Depends(get_suite_service)
) -> ProvisionResult:
    return await service.provision(body)


@router.post("/authorize", response_model=AuthorizeResult)
async def authorize(
    body: AuthorizeRequest, service: SuiteService = Depends(get_suite_service)
) -> AuthorizeResult:
    return await service.authorize(body)


@router.get("/teams")
async def list_teams(service: SuiteService = Depends(get_suite_service)) -> list[dict[str, str]]:
    """Every team (Kanban teams have no archived state), for the portal's lead picker."""
    return [{"id": t.id, "name": t.name} for t in await service.list_teams()]
