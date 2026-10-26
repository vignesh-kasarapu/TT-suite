"""Declarative base. The schema itself is owned by the SQL migrations (alembic/sql/*.sql);
these models mirror it for queries and must never be used to autogenerate a migration.

The naming convention reproduces PostgreSQL's own default constraint names, which the
existing migrations rely on (e.g. 0010 drops `app_user_status_check` by name).
"""

from sqlalchemy import CHAR, MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING = {
    "pk": "%(table_name)s_pkey",
    "fk": "%(table_name)s_%(column_0_name)s_fkey",
    "uq": "%(table_name)s_%(column_0_N_name)s_key",
    "ck": "%(table_name)s_%(constraint_name)s_check",
    "ix": "%(table_name)s_%(column_0_name)s_idx",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def Ulid() -> CHAR:  # noqa: N802 - reads as a column type
    """ULID columns are char(26)."""
    return CHAR(26)
