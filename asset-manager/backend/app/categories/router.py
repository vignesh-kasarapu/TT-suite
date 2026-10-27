from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.orm import Session

from app.categories.schemas import (
    CategoryCreateRequest,
    CategoryResponse,
    CategoryUpdateRequest,
)
from app.categories.service import CategoryService
from app.common.database import get_db
from app.common.enums import UserRole
from app.common.exceptions import ErrorResponse
from app.common.security import get_current_user, require_roles
from app.users.models import User

router = APIRouter(prefix="/categories", tags=["Categories"])


@router.get(
    "",
    response_model=list[CategoryResponse],
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
    },
    summary="List all asset categories (All authenticated roles)",
)
def list_categories(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    size: int = Query(100, ge=1, le=200, description="Items per page"),
    sort: str = Query("id,asc", description="Sort field and direction, e.g. name,asc"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> list[CategoryResponse]:
    service = CategoryService(db)
    return service.list_categories(page=page, size=size, sort=sort)


@router.post(
    "",
    response_model=CategoryResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ADMIN required)"},
        409: {"model": ErrorResponse, "description": "Category already exists"},
    },
    summary="Create a new asset category (ADMIN only)",
)
def create_category(
    payload: CategoryCreateRequest,
    db: Session = Depends(get_db),
    _current_admin: User = Depends(require_roles(UserRole.ADMIN)),
) -> CategoryResponse:
    service = CategoryService(db)
    return service.create_category(payload)


@router.patch(
    "/{id}",
    response_model=CategoryResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Validation error"},
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Category not found"},
        409: {"model": ErrorResponse, "description": "Category name already exists"},
    },
    summary="Rename an asset category (ADMIN only)",
)
def update_category(
    payload: CategoryUpdateRequest,
    id: int = Path(..., ge=1, description="Category ID"),
    db: Session = Depends(get_db),
    _current_admin: User = Depends(require_roles(UserRole.ADMIN)),
) -> CategoryResponse:
    service = CategoryService(db)
    return service.update_category(category_id=id, payload=payload)


@router.delete(
    "/{id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={
        401: {"model": ErrorResponse, "description": "Unauthenticated"},
        403: {"model": ErrorResponse, "description": "Forbidden (ADMIN required)"},
        404: {"model": ErrorResponse, "description": "Category not found"},
        409: {
            "model": ErrorResponse,
            "description": "Category still has assets assigned",
        },
    },
    summary="Delete an empty asset category (ADMIN only)",
)
def delete_category(
    id: int = Path(..., ge=1, description="Category ID"),
    db: Session = Depends(get_db),
    _current_admin: User = Depends(require_roles(UserRole.ADMIN)),
) -> Response:
    service = CategoryService(db)
    service.delete_category(category_id=id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
