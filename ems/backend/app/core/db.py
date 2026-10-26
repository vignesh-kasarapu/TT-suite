from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import SCHEMA, settings

# EMS tables are unqualified and found through search_path; the global app.* tables are always qualified.
CONNECT_ARGS = {"options": f"-csearch_path={SCHEMA}"}

engine = create_engine(settings.db_url, pool_pre_ping=True, pool_size=5, max_overflow=2, connect_args=CONNECT_ARGS)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
