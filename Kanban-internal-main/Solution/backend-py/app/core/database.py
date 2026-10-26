"""Async database access (SQLAlchemy 2.0 + psycopg 3) and the unit of work.

The app connects as the runtime role (`DATABASE_URL`, pool of `DB_POOL_SIZE`, default 5 - the
TT Suite runs four processes on one small App Service). Only migrations use the owner URL (see
`app/db/migrate.py`).
"""

from collections.abc import AsyncIterator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


# TT Suite: Kanban's tables live in schema `kanban` of the one suite database. The SQL stays
# unqualified and is resolved through the connection's search_path; `public` stays second for
# anything installed there (extensions). See app/db/migrate.py for the one-time move.
SCHEMA = "kanban"
SEARCH_PATH = f"{SCHEMA},public"


def with_search_path(url: str) -> str:
    """Add `options=-csearch_path=kanban,public` to a connection URL (kept if one is set)."""
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query))
    query.setdefault("options", f"-csearch_path={SEARCH_PATH}")
    return urlunsplit(parts._replace(query=urlencode(query)))


def sqlalchemy_url(url: str, driver: str = "psycopg") -> str:
    """postgres://... (the deployment format) -> postgresql+psycopg://..., on Kanban's schema."""
    parts = urlsplit(with_search_path(url))
    return urlunsplit(parts._replace(scheme=f"postgresql+{driver}"))


def create_engine(database_url: str, pool_size: int = 5) -> AsyncEngine:
    return create_async_engine(
        sqlalchemy_url(database_url),
        pool_size=pool_size,
        max_overflow=0,
        pool_pre_ping=False,
        # Health probes must answer quickly when the database is down.
        connect_args={"connect_timeout": 5},
    )


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


class UnitOfWork:
    """One request's transaction. Services call `commit()` once their writes succeeded;
    anything not committed is rolled back when the request ends (success -> commit,
    expected or unexpected failure -> rollback)."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def commit(self) -> None:
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()


async def session_scope(maker: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    session = maker()
    try:
        yield session
    finally:
        await session.close()  # rolls back whatever was not committed
