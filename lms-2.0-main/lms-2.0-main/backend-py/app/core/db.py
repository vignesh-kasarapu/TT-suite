from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.core.config import DB_SCHEMA, settings

# Every LMS table lives in schema `lms` of the suite's shared database. Models stay
# schema-less; the connection's search_path resolves them, and the suite identity
# tables are always addressed as `app.*` (see suite_core.identity).
engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=5,
    connect_args={"options": f"-csearch_path={DB_SCHEMA}"},
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    """Shared declarative base for every SQLAlchemy model (app/models/*)."""


def get_db():
    """FastAPI dependency — one Session per request, always closed after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
