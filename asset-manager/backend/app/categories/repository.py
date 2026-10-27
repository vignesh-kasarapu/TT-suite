from sqlalchemy import asc, case, desc, func, select
from sqlalchemy.orm import Session

from app.assets.models import Asset
from app.categories.models import Category
from app.common.enums import AssetStatus


class CategoryRepository:
    SORTABLE_COLUMNS = {
        "id": Category.id,
        "name": Category.name,
        "created_at": Category.created_at,
    }

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, category_id: int) -> Category | None:
        return self.db.get(Category, category_id)

    def get_by_name(self, name: str) -> Category | None:
        normalized = name.strip().lower()
        stmt = select(Category).where(func.lower(Category.name) == normalized)
        return self.db.scalar(stmt)

    def list_categories_with_counts(
        self,
        page: int = 1,
        size: int = 100,
        sort: str = "id,asc",
    ) -> list[dict]:
        parts = [p.strip() for p in sort.split(",") if p.strip()]
        sort_field = parts[0] if parts else "id"
        sort_dir = parts[1].lower() if len(parts) > 1 else "asc"
        column = self.SORTABLE_COLUMNS.get(sort_field, Category.id)
        order_expr = desc(column) if sort_dir == "desc" else asc(column)

        total_count = func.count(Asset.id).label("total_assets")
        available_count = func.coalesce(
            func.sum(case((Asset.status == AssetStatus.AVAILABLE, 1), else_=0)),
            0,
        ).label("available_assets")

        stmt = (
            select(Category, total_count, available_count)
            .outerjoin(Asset, Asset.category_id == Category.id)
            .group_by(Category.id)
            .order_by(order_expr, asc(Category.id))
            .offset((page - 1) * size)
            .limit(size)
        )
        rows = self.db.execute(stmt).all()
        results: list[dict] = []
        for cat, total, available in rows:
            results.append(
                {
                    "id": cat.id,
                    "name": cat.name,
                    "total_assets": int(total or 0),
                    "available_assets": int(available or 0),
                    "created_at": cat.created_at,
                }
            )
        return results

    def create(self, name: str) -> Category:
        category = Category(name=name.strip())
        self.db.add(category)
        self.db.flush()
        self.db.refresh(category)
        return category

    def count_assets(self, category_id: int) -> int:
        stmt = (
            select(func.count())
            .select_from(Asset)
            .where(Asset.category_id == category_id)
        )
        return int(self.db.scalar(stmt) or 0)

    def update_name(self, category: Category, name: str) -> Category:
        category.name = name.strip()
        self.db.flush()
        self.db.refresh(category)
        return category

    def delete(self, category: Category) -> None:
        self.db.delete(category)
        self.db.flush()
