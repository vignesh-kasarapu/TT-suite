import logging
from sqlalchemy.orm import Session

from app.categories.repository import CategoryRepository
from app.categories.schemas import (
    CategoryCreateRequest,
    CategoryResponse,
    CategoryUpdateRequest,
)
from app.common.database import transactional
from app.common.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
)

logger = logging.getLogger("ams.categories")


class CategoryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = CategoryRepository(db)

    def list_categories(
        self,
        page: int = 1,
        size: int = 100,
        sort: str = "id,asc",
    ) -> list[CategoryResponse]:
        if page < 1 or size < 1:
            raise BadRequestException("Pagination parameters page and size must be >= 1")
        categories = self.repository.list_categories_with_counts(
            page=page,
            size=size,
            sort=sort,
        )
        return [CategoryResponse.model_validate(cat) for cat in categories]

    def _to_response(self, category_id: int) -> CategoryResponse:
        rows = self.repository.list_categories_with_counts(page=1, size=200, sort="id,asc")
        match = next((c for c in rows if c["id"] == category_id), None)
        if match is None:
            raise NotFoundException(f"Category with id {category_id} not found")
        return CategoryResponse.model_validate(match)

    @transactional
    def create_category(self, payload: CategoryCreateRequest) -> CategoryResponse:
        cleaned_name = payload.name.strip()
        existing = self.repository.get_by_name(cleaned_name)
        if existing is not None:
            raise ConflictException(f"Category '{cleaned_name}' already exists")

        category = self.repository.create(name=cleaned_name)
        logger.info("Created category id=%s name=%s", category.id, category.name)
        return CategoryResponse(
            id=category.id,
            name=category.name,
            total_assets=0,
            available_assets=0,
            created_at=category.created_at,
        )

    @transactional
    def update_category(
        self,
        category_id: int,
        payload: CategoryUpdateRequest,
    ) -> CategoryResponse:
        category = self.repository.get_by_id(category_id)
        if category is None:
            raise NotFoundException(f"Category with id {category_id} not found")

        cleaned_name = payload.name.strip()
        existing = self.repository.get_by_name(cleaned_name)
        if existing is not None and existing.id != category.id:
            raise ConflictException(f"Category '{cleaned_name}' already exists")

        self.repository.update_name(category, cleaned_name)
        logger.info("Updated category id=%s name=%s", category.id, category.name)
        return self._to_response(category.id)

    @transactional
    def delete_category(self, category_id: int) -> None:
        category = self.repository.get_by_id(category_id)
        if category is None:
            raise NotFoundException(f"Category with id {category_id} not found")

        asset_count = self.repository.count_assets(category_id)
        if asset_count > 0:
            raise ConflictException(
                f"Cannot delete category '{category.name}' while {asset_count} asset(s) still use it"
            )

        name = category.name
        self.repository.delete(category)
        logger.info("Deleted category id=%s name=%s", category_id, name)
