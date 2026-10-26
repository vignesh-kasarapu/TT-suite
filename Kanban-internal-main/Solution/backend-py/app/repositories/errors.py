"""Database outcomes a service decides about, without seeing SQLAlchemy."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.exc import IntegrityError


class UniqueViolation(Exception):
    """A unique constraint or index refused the write (SQLSTATE 23505)."""


@asynccontextmanager
async def unique_guard() -> AsyncIterator[None]:
    """Turn a unique-constraint failure inside the block into `UniqueViolation`."""
    try:
        yield
    except IntegrityError as err:
        if getattr(err.orig, "sqlstate", None) == "23505":
            raise UniqueViolation from err
        raise
