from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.assets.schemas import AssetCreateRequest
from app.assignments.schemas import (
    AssetHistoryResponse,
    AssignAssetRequest,
    AssignedAssetResponse,
    AssignmentResponse,
    EmployeeAssetDetailsRequest,
    ReturnAssetRequest,
)
from app.assignments.service import AssignmentService
from app.common.database import get_db
from app.common.enums import UserRole
from app.common.exceptions import ErrorResponse
from app.common.security import get_current_user, require_roles
from app.users.models import User

router = APIRouter(tags=["Assignments"])


@router.post(
    "/assets/{id}/assign",
    response_model=AssignmentResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid user or inactive user"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Asset or user not found"},
        409: {"model": ErrorResponse, "description": "Asset is not AVAILABLE or already has an open assignment"},
    },
    summary="Assign an available asset to an active employee (FR-7, FR-13)",
)
def assign_asset(
    payload: AssignAssetRequest,
    id: int = Path(..., ge=1, description="Asset ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> AssignmentResponse:
    service = AssignmentService(db)
    return service.assign_asset(
        asset_id=id,
        payload=payload,
        actor_user_id=current_user.id,
        actor_email=current_user.email,
    )


@router.post(
    "/assets/{id}/return",
    response_model=AssignmentResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid return request"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Asset not found"},
        409: {"model": ErrorResponse, "description": "Asset is not currently ASSIGNED"},
    },
    summary="Record asset return and transition asset to AVAILABLE, IN_MAINTENANCE, or RETIRED (FR-8, FR-13, FR-14)",
)
def return_asset(
    payload: ReturnAssetRequest,
    id: int = Path(..., ge=1, description="Asset ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> AssignmentResponse:
    service = AssignmentService(db)
    return service.return_asset(
        asset_id=id,
        payload=payload,
        actor_user_id=current_user.id,
        actor_email=current_user.email,
    )


@router.get(
    "/assets/{id}/history",
    response_model=AssetHistoryResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Asset not found"},
    },
    summary="View complete assignment and maintenance history for an asset (FR-9)",
)
def get_asset_history(
    id: int = Path(..., ge=1, description="Asset ID"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> AssetHistoryResponse:
    service = AssignmentService(db)
    return service.get_asset_history(asset_id=id)


@router.get(
    "/me/assets",
    response_model=list[AssignedAssetResponse],
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
    },
    summary="List assets currently assigned to the authenticated user (FR-9)",
)
def list_my_assets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[AssignedAssetResponse]:
    service = AssignmentService(db)
    return service.list_user_active_assets(user_id=current_user.id)


@router.post(
    "/me/assets",
    response_model=AssignedAssetResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (EMPLOYEE required)"},
        404: {"model": ErrorResponse, "description": "Category not found"},
        409: {"model": ErrorResponse, "description": "Duplicate serial_no or tag"},
    },
    summary="Employee registers a held asset (create + self-assign) (FR-19)",
)
def register_my_asset(
    payload: AssetCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.EMPLOYEE)),
) -> AssignedAssetResponse:
    service = AssignmentService(db)
    return service.register_my_asset(payload=payload, current_user=current_user)


@router.patch(
    "/me/assets/{id}/details",
    response_model=AssignedAssetResponse,
    responses={
        400: {"model": ErrorResponse, "description": "No details provided"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        404: {"model": ErrorResponse, "description": "Asset not found"},
        409: {
            "model": ErrorResponse,
            "description": "Not your asset, or tag already set / duplicate",
        },
    },
    summary="Employee one-time fill of blank service_tag / asset_tag on a held asset",
)
def fill_my_asset_details(
    payload: EmployeeAssetDetailsRequest,
    id: int = Path(..., ge=1, description="Asset ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignedAssetResponse:
    service = AssignmentService(db)
    return service.fill_my_asset_details(
        asset_id=id,
        user_id=current_user.id,
        payload=payload,
    )


@router.get(
    "/users/{id}/assets",
    response_model=list[AssignedAssetResponse],
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "User not found"},
    },
    summary="List all active assets held by a specific employee for offboarding (FR-9, FR-14)",
)
def list_user_assets(
    id: int = Path(..., ge=1, description="User ID"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> list[AssignedAssetResponse]:
    service = AssignmentService(db)
    return service.list_user_active_assets(user_id=id)
