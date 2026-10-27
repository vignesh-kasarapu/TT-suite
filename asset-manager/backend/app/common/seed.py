from sqlalchemy import select
from sqlalchemy.orm import Session

from app.categories.models import Category
from app.common.database import SessionLocal

# TT Suite: people are not seeded here. They come from the portal (the global admin, the suite's
# SEED_GLOBAL_ADMIN_EMAIL / SEED_FILE) and get their AMS user on first visit.
DEFAULT_CATEGORIES = ["Laptop", "Monitor", "Phone", "Furniture"]


def seed_database(db: Session) -> None:
    """Idempotently seed the default asset categories."""
    for category_name in DEFAULT_CATEGORIES:
        existing_category = db.scalar(
            select(Category).where(Category.name == category_name)
        )
        if existing_category is None:
            db.add(Category(name=category_name))

    db.commit()


if __name__ == "__main__":
    with SessionLocal() as session:
        seed_database(session)
