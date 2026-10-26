"""Administration > Login issues (D-144): messages from people who cannot sign in."""

from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app.core.security import Actor
from app.dependencies.auth import RoleRoute, current_actor, roles
from app.dependencies.services import get_login_issue_service
from app.schemas.common_schema import Id, problem_responses
from app.schemas.login_issue_schema import LoginIssueList
from app.services.login_issue_service import LoginIssueService

router = APIRouter(prefix="/admin/login-issues", tags=["admin"], route_class=RoleRoute)


@router.get(
    "",
    operation_id="listLoginIssues",
    summary="Messages from people who cannot sign in: open ones first, then newest first",
    response_model=LoginIssueList,
    openapi_extra=roles("admin"),
)
async def list_login_issues(
    service: LoginIssueService = Depends(get_login_issue_service),
) -> LoginIssueList:
    return await service.list_all()


@router.post(
    "/{issueId}/resolve",
    operation_id="resolveLoginIssue",
    summary="Mark a login issue resolved (who and when are kept; a second call changes nothing)",
    response_model=LoginIssueList,
    responses=problem_responses(404),
    openapi_extra=roles("admin"),
)
async def resolve_login_issue(
    issue_id: Annotated[Id, Path(alias="issueId")],
    actor: Actor = Depends(current_actor),
    service: LoginIssueService = Depends(get_login_issue_service),
) -> LoginIssueList:
    return await service.resolve(actor, issue_id)
