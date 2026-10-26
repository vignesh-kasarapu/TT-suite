"""Database reachability for the health probe."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class SystemRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def ping(self) -> bool:
        try:
            await self.db.execute(text("select 1"))
            return True
        except Exception:  # any failure to reach the database is "down"
            return False
