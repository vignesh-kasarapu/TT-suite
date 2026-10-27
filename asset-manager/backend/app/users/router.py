from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Request
from sqlalchemy.orm import Session
from suite_core import inbox
from suite_core.identity import SuiteAccessError

from app.common.database import get_db
from app.common.enums import UserRole
from app.common.config import APP
from app.common.exceptions import AppException, ErrorResponse, NotFoundException
from app.common.security import require_roles
from app.users.models import User
from app.users.schemas import (
    PaginatedUsersResponse,
    RoleChangeRequest,
    RoleChangeRequestResponse,
    RoleRequestResponse,
    UserResponse,
)
from app.users.service import UserService

# TT Suite: only the global admin (in the portal) creates people, assigns roles, changes emails and
# deactivates; the portal does that through POST /internal/provision. Here an AMS admin can only
# list people and *request* a role change, which lands in the global admins' inbox.
router = APIRouter(prefix="/users", tags=["Users"])


@router.get(
    "/directory",
    response_model=list[UserResponse],
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
    },
    summary="List employee directory with held asset counts for assignment and offboarding (FR-7, FR-14)",
)
def list_user_directory(
    active_only: bool = Query(False, description="Only return active users"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> list[UserResponse]:
    service = UserService(db)
    return service.list_directory(active_only=active_only)


@router.get(
    "",
    response_model=PaginatedUsersResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid query parameters"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ADMIN required)"},
    },
    summary="List users with pagination, sorting, and filtering (FR-2)",
)
def list_users(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    size: int = Query(20, ge=1, le=100, description="Items per page"),
    sort: str = Query("id,asc", description="Sort field and direction, e.g. name,asc"),
    search: str | None = Query(None, description="Search by name or email"),
    role: UserRole | None = Query(None, description="Filter by user role"),
    active: bool | None = Query(None, description="Filter by active status"),
    db: Session = Depends(get_db),
    _current_admin: User = Depends(require_roles(UserRole.ADMIN)),
) -> PaginatedUsersResponse:
    service = UserService(db)
    return service.list_users(
        page=page,
        size=size,
        sort=sort,
        search=search,
        role=role,
        active=active,
    )


@router.get(
    "/role-requests",
    response_model=list[RoleRequestResponse],
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ADMIN required)"},
    },
    summary="Open role-change requests for Asset Management, awaiting the global admin",
)
def list_role_requests(
    db: Session = Depends(get_db),
    _current_admin: User = Depends(require_roles(UserRole.ADMIN)),
) -> list[dict[str, Any]]:
    return inbox.pending_requests(db, APP)


@router.post(
    "/{id}/role-request",
    response_model=RoleChangeRequestResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ADMIN required)"},
        404: {"model": ErrorResponse, "description": "User not found"},
        422: {"model": ErrorResponse, "description": "Unknown role (code UNKNOWN_ROLE)"},
    },
    summary="Ask the global admin to change a person's Asset Management role (role null = remove access)",
)
def request_role_change(
    payload: RoleChangeRequest,
    request: Request,
    id: int = Path(..., ge=1, description="User ID"),
    db: Session = Depends(get_db),
    _current_admin: User = Depends(require_roles(UserRole.ADMIN)),
) -> RoleChangeRequestResponse:
    target = db.get(User, id)
    if target is None:
        raise NotFoundException(f"User with id {id} not found")
    try:
        request_id = inbox.request_role_change(
            db,
            app=APP,
            email=target.email,
            role=payload.role,
            requested_by=request.state.suite.user_id,
            note=payload.note,
        )
    except SuiteAccessError as exc:
        db.rollback()
        code = "UNKNOWN_ROLE" if "unknown role" in str(exc) else "NOT_IN_SUITE"
        raise AppException(422, str(exc), code=code) from exc
    db.commit()
    return RoleChangeRequestResponse(id=request_id, role=payload.role)
