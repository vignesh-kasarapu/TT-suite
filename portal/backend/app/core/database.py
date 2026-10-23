"""Async database access (SQLAlchemy 2 + psycopg 3), the same shape as Kanban's.
The portal only touches schema `suite` and always qualifies its tables."""

from urllib.parse import urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine


def sqlalchemy_url(url: str) -> str:
    return urlunsplit(urlsplit(url)._replace(scheme="postgresql+psycopg"))


def create_engine(database_url: str, pool_size: int) -> AsyncEngine:
    return create_async_engine(
        sqlalchemy_url(database_url),
        pool_size=pool_size,
        max_overflow=0,
        connect_args={"connect_timeout": 5},
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
