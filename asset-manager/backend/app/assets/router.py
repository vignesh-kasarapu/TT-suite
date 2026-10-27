from fastapi import APIRouter, Depends, Path, Query, Response
from sqlalchemy.orm import Session

from app.assets.schemas import (
    AssetBulkImportRequest,
    AssetBulkImportResponse,
    AssetCreateRequest,
    AssetResponse,
    AssetUpdateRequest,
    PaginatedAssetsResponse,
)
from app.assets.service import AssetService
from app.common.database import get_db
from app.common.enums import AssetStatus, UserRole
from app.common.exceptions import ErrorResponse
from app.common.security import require_roles
from app.users.models import User

router = APIRouter(prefix="/assets", tags=["Assets"])


@router.get(
    "",
    response_model=PaginatedAssetsResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid query parameters"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
    },
    summary="List assets with pagination, search by name/tag, and filter by category and status (FR-6)",
)
def list_assets(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    size: int = Query(20, ge=1, le=100, description="Items per page"),
    sort: str = Query("id,asc", description="Sort field and direction, e.g. tag,asc"),
    search: str | None = Query(
        None,
        description=(
            "Search by name, Asset ID (tag), service_tag, asset_tag, serial_no, "
            "or assigned employee name"
        ),
    ),
    category: str | None = Query(None, description="Filter by category ID or name"),
    category_id: int | None = Query(None, ge=1, description="Filter by category ID"),
    status: AssetStatus | None = Query(None, description="Filter by asset status"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> PaginatedAssetsResponse:
    service = AssetService(db)
    return service.list_assets(
        page=page,
        size=size,
        sort=sort,
        search=search,
        category=category,
        category_id=category_id,
        status=status,
    )


@router.get(
    "/import/template",
    responses={
        200: {
            "content": {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {}
            },
            "description": "Download sample Assets Excel (.xlsx) import template",
        },
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
    },
    summary="Download Assets Excel (.xlsx) import template (FR-3)",
)
def download_assets_import_template(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> Response:
    service = AssetService(db)
    xlsx_bytes = service.generate_assets_excel_template()
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="tektalis_assets_import_template.xlsx"'
        },
    )


@router.post(
    "/import",
    response_model=AssetBulkImportResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid Excel/CSV format or missing headers"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
    },
    summary="Bulk import assets from Excel (.xlsx) or tabular paste with auto-category creation, TEK hex tags, and optional auto-assignment (FR-3, FR-4, FR-7)",
)
def import_assets(
    payload: AssetBulkImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> AssetBulkImportResponse:
    service = AssetService(db)
    return service.import_assets_data(
        actor_user_id=current_user.id,
        excel_base64=payload.excel_base64,
        csv_content=payload.csv_content,
    )


@router.post(
    "",
    response_model=AssetResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Category not found"},
        409: {"model": ErrorResponse, "description": "Duplicate serial_no"},
    },
    summary="Create a new asset with service_tag, asset_tag, and auto-generated Asset ID (FR-3, FR-4)",
)
def create_asset(
    payload: AssetCreateRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> AssetResponse:
    service = AssetService(db)
    return service.create_asset(payload)


@router.get(
    "/{id}",
    response_model=AssetResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Asset not found"},
    },
    summary="View asset details by ID (FR-5)",
)
def get_asset(
    id: int = Path(..., ge=1, description="Asset ID"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> AssetResponse:
    service = AssetService(db)
    return service.get_asset(asset_id=id)


@router.put(
    "/{id}",
    response_model=AssetResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Asset or category not found"},
        409: {"model": ErrorResponse, "description": "Immutable field edit or asset is RETIRED/ASSIGNED"},
    },
    summary="Edit an asset (Asset ID immutable; RETIRED/ASSIGNED blocked) (FR-5)",
)
def update_asset(
    payload: AssetUpdateRequest,
    id: int = Path(..., ge=1, description="Asset ID"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> AssetResponse:
    service = AssetService(db)
    return service.update_asset(asset_id=id, payload=payload)


@router.patch(
    "/{id}/retire",
    response_model=AssetResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ASSET_MANAGER or ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Asset not found"},
        409: {"model": ErrorResponse, "description": "Asset is already RETIRED or not AVAILABLE"},
    },
    summary="Retire an AVAILABLE asset (never hard-deleted, audit logged) (FR-5)",
)
def retire_asset(
    id: int = Path(..., ge=1, description="Asset ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ASSET_MANAGER, UserRole.ADMIN)),
) -> AssetResponse:
    service = AssetService(db)
    return service.retire_asset(asset_id=id, actor_user_id=current_user.id)
