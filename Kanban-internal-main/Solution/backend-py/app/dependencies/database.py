"""Per-request database session and unit of work."""

from collections.abc import AsyncIterator

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import Clock
from app.core.config import Settings
from app.core.database import UnitOfWork, session_scope


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    """One session per request, shared by every repository the request touches. What a service
    did not commit is rolled back when the request ends."""
    async for session in session_scope(request.app.state.sessionmaker):
        yield session


def get_uow(db: AsyncSession = Depends(get_db)) -> UnitOfWork:
    return UnitOfWork(db)


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_clock(request: Request) -> Clock:
    clock: Clock = request.app.state.clock
    return clock
