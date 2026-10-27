from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.enums import UserRole
from app.common.exceptions import ErrorResponse
from app.common.security import require_roles
from app.maintenance.schemas import (
    MaintenanceCloseRequest,
    MaintenanceCreateRequest,
    MaintenanceRecordResponse,
)
from app.maintenance.service import MaintenanceService
from app.users.models import User

router = APIRouter(tags=["Maintenance"])


@router.get(
    "/maintenance",
    response_model=list[MaintenanceRecordResponse],
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
    },
    summary="List maintenance records across all assets (FR-10, FR-11)",
)
def list_maintenance_records(
    open_only: bool = Query(False, description="Only return open maintenance records"),
    asset_id: int | None = Query(None, ge=1, description="Filter by asset ID"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> list[MaintenanceRecordResponse]:
    service = MaintenanceService(db)
    return service.list_maintenance_records(open_only=open_only, asset_id=asset_id)


@router.post(
    "/assets/{id}/maintenance",
    response_model=MaintenanceRecordResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Asset not found"},
        409: {"model": ErrorResponse, "description": "Asset is not AVAILABLE or already in maintenance"},
    },
    summary="Log a maintenance record and lock the asset in IN_MAINTENANCE state (FR-10, FR-11)",
)
def open_maintenance(
    payload: MaintenanceCreateRequest,
    id: int = Path(..., ge=1, description="Asset ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> MaintenanceRecordResponse:
    service = MaintenanceService(db)
    return service.open_maintenance(
        asset_id=id,
        payload=payload,
        actor_user_id=current_user.id,
    )


@router.patch(
    "/maintenance/{id}/close",
    response_model=MaintenanceRecordResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Maintenance record or asset not found"},
        409: {"model": ErrorResponse, "description": "Maintenance record is already closed"},
    },
    summary="Close an open maintenance record and transition the asset back to AVAILABLE (FR-11)",
)
def close_maintenance(
    payload: MaintenanceCloseRequest,
    id: int = Path(..., ge=1, description="Maintenance Record ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> MaintenanceRecordResponse:
    service = MaintenanceService(db)
    return service.close_maintenance(
        record_id=id,
        payload=payload,
        actor_user_id=current_user.id,
    )
