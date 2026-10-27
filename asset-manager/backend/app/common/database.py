from functools import wraps
from typing import Any, Callable, Generator, TypeVar
from sqlalchemy import BigInteger, Integer, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.common.config import SCHEMA, settings

# BIGSERIAL in PostgreSQL (the SQLite variant is kept for the model definitions only)
BigIntPK = BigInteger().with_variant(Integer, "sqlite")


class Base(DeclarativeBase):
    pass


# TT Suite: AMS tables are unqualified and found through search_path; the global app.* tables are
# always written in full.
CONNECT_ARGS = {"options": f"-csearch_path={SCHEMA}"}
engine = create_engine(settings.db_url, pool_pre_ping=True, pool_size=5, max_overflow=2, connect_args=CONNECT_ARGS)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


F = TypeVar("F", bound=Callable[..., Any])


def transactional(func: F) -> F:
    """Decorator to run a service method inside a database transaction."""

    @wraps(func)
    def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
        db: Session | None = getattr(self, "db", None)
        if db is None:
            for arg in args:
                if isinstance(arg, Session):
                    db = arg
                    break
            if db is None and "db" in kwargs and isinstance(kwargs["db"], Session):
                db = kwargs["db"]

        if db is None:
            return func(self, *args, **kwargs)

        try:
            result = func(self, *args, **kwargs)
            db.commit()
            return result
        except Exception:
            db.rollback()
            raise

    return wrapper  # type: ignore[return-value]
