from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.enums import ReplacementStatus, UserRole
from app.common.exceptions import ErrorResponse
from app.common.security import get_current_user, require_roles
from app.replacements.schemas import (
    ApproveReplacementRequest,
    HoldReplacementRequest,
    RejectReplacementRequest,
    ReplacementRequestCreate,
    ReplacementRequestResponse,
)
from app.replacements.service import ReplacementService
from app.users.models import User

router = APIRouter(prefix="/replacement-requests", tags=["Replacements"])


@router.get(
    "",
    response_model=list[ReplacementRequestResponse],
    status_code=status.HTTP_200_OK,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
    },
    summary="List replacement requests (own for EMPLOYEE, all for ASSET_MANAGER/ADMIN) (FR-15, FR-16)",
)
def list_replacement_requests(
    status_filter: ReplacementStatus | None = Query(
        default=None,
        alias="status",
        description="Optional filter by replacement request status",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ReplacementRequestResponse]:
    service = ReplacementService(db)
    return service.list_requests(current_user=current_user, status=status_filter)


@router.post(
    "",
    response_model=ReplacementRequestResponse,
    status_code=status.HTTP_200_OK,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        404: {"model": ErrorResponse, "description": "Asset not found"},
        409: {"model": ErrorResponse, "description": "Asset not assigned to user or already has pending request"},
    },
    summary="Raise a replacement request for a currently held asset (FR-15)",
)
def create_replacement_request(
    payload: ReplacementRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReplacementRequestResponse:
    service = ReplacementService(db)
    return service.create_request(payload=payload, current_user=current_user)


@router.patch(
    "/{id}/approve",
    response_model=ReplacementRequestResponse,
    status_code=status.HTTP_200_OK,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Replacement request or asset not found"},
        409: {"model": ErrorResponse, "description": "Request not PENDING or replacement asset not AVAILABLE"},
    },
    summary="Approve a replacement request and atomically swap assets (FR-16, FR-17)",
)
def approve_replacement_request(
    payload: ApproveReplacementRequest,
    id: int = Path(..., ge=1, description="Replacement Request ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> ReplacementRequestResponse:
    service = ReplacementService(db)
    return service.approve_request(
        request_id=id,
        payload=payload,
        actor_user_id=current_user.id,
    )


@router.patch(
    "/{id}/reject",
    response_model=ReplacementRequestResponse,
    status_code=status.HTTP_200_OK,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Replacement request not found"},
        409: {"model": ErrorResponse, "description": "Request is not PENDING or ON_HOLD"},
    },
    summary="Reject a replacement request with a decision comment (FR-16)",
)
def reject_replacement_request(
    payload: RejectReplacementRequest,
    id: int = Path(..., ge=1, description="Replacement Request ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> ReplacementRequestResponse:
    service = ReplacementService(db)
    return service.reject_request(
        request_id=id,
        payload=payload,
        actor_user_id=current_user.id,
    )


@router.patch(
    "/{id}/hold",
    response_model=ReplacementRequestResponse,
    status_code=status.HTTP_200_OK,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Replacement request not found"},
        409: {"model": ErrorResponse, "description": "Request is not PENDING or ON_HOLD"},
    },
    summary="Mark replacement request ON_HOLD when no matching AVAILABLE stock (FR-16)",
)
def hold_replacement_request(
    id: int = Path(..., ge=1, description="Replacement Request ID"),
    payload: HoldReplacementRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> ReplacementRequestResponse:
    body = payload or HoldReplacementRequest()
    service = ReplacementService(db)
    return service.hold_request(
        request_id=id,
        actor_user_id=current_user.id,
        comment=body.comment,
    )
