from fastapi import APIRouter, Depends, Path, Query, status  # Query used by available-assets
from sqlalchemy.orm import Session

from app.asset_requests.schemas import (
    ApproveAssetRequest,
    AssetRequestCreate,
    AssetRequestResponse,
    AvailableAssetsForRequestResponse,
    RejectAssetRequest,
)
from app.asset_requests.service import AssetRequestService
from app.common.database import get_db
from app.common.enums import AssetRequestStatus, UserRole
from app.common.exceptions import ErrorResponse
from app.common.security import get_current_user, require_roles
from app.users.models import User

router = APIRouter(prefix="/asset-requests", tags=["Asset Requests"])


@router.get(
    "",
    response_model=list[AssetRequestResponse],
    status_code=status.HTTP_200_OK,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
    },
    summary="List asset requests (own for EMPLOYEE, all for ASSET_MANAGER/ADMIN)",
)
def list_asset_requests(
    status_filter: AssetRequestStatus | None = Query(
        default=None,
        alias="status",
        description="Optional filter by asset request status",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[AssetRequestResponse]:
    service = AssetRequestService(db)
    return service.list_requests(current_user=current_user, status=status_filter)


@router.post(
    "",
    response_model=AssetRequestResponse,
    status_code=status.HTTP_200_OK,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        404: {"model": ErrorResponse, "description": "Category not found"},
        409: {
            "model": ErrorResponse,
            "description": "Duplicate serial/tag or non-employee create",
        },
    },
    summary="Employee submits a new asset request (immutable after create)",
)
def create_asset_request(
    payload: AssetRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssetRequestResponse:
    service = AssetRequestService(db)
    return service.create_request(payload=payload, current_user=current_user)


@router.get(
    "/{id}/available-assets",
    response_model=AvailableAssetsForRequestResponse,
    status_code=status.HTTP_200_OK,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {
            "model": ErrorResponse,
            "description": "Forbidden (ASSET_MANAGER or ADMIN required)",
        },
        404: {"model": ErrorResponse, "description": "Request or category not found"},
    },
    summary="List AVAILABLE inventory assets for the request category (approve stock check)",
)
def list_available_assets_for_request(
    id: int = Path(..., ge=1, description="Asset Request ID"),
    category_id: int | None = Query(
        default=None,
        ge=1,
        description="Optional category override when previewing Other mapping",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> AvailableAssetsForRequestResponse:
    service = AssetRequestService(db)
    return service.list_available_assets_for_request(
        request_id=id,
        category_id=category_id,
    )


@router.patch(
    "/{id}/approve",
    response_model=AssetRequestResponse,
    status_code=status.HTTP_200_OK,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {
            "model": ErrorResponse,
            "description": "Forbidden (ASSET_MANAGER or ADMIN required)",
        },
        404: {"model": ErrorResponse, "description": "Request or category not found"},
        409: {
            "model": ErrorResponse,
            "description": "Request not PENDING, stock requires asset_id, or assign conflict",
        },
    },
    summary="Approve asset request; assign AVAILABLE asset when stock exists",
)
def approve_asset_request(
    payload: ApproveAssetRequest,
    id: int = Path(..., ge=1, description="Asset Request ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> AssetRequestResponse:
    service = AssetRequestService(db)
    return service.approve_request(
        request_id=id,
        payload=payload,
        actor_user_id=current_user.id,
    )


@router.patch(
    "/{id}/reject",
    response_model=AssetRequestResponse,
    status_code=status.HTTP_200_OK,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {
            "model": ErrorResponse,
            "description": "Forbidden (ASSET_MANAGER or ADMIN required)",
        },
        404: {"model": ErrorResponse, "description": "Request not found"},
        409: {"model": ErrorResponse, "description": "Request is not PENDING"},
    },
    summary="Reject an asset request with a decision comment",
)
def reject_asset_request(
    payload: RejectAssetRequest,
    id: int = Path(..., ge=1, description="Asset Request ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> AssetRequestResponse:
    service = AssetRequestService(db)
    return service.reject_request(
        request_id=id,
        payload=payload,
        actor_user_id=current_user.id,
    )
