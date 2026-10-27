"""Add resolution column to maintenance_records

Revision ID: 0002_add_maintenance_resolution
Revises: 0001_initial_schema
Create Date: 2026-10-24 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_add_maintenance_resolution"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "maintenance_records",
        sa.Column("resolution", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("maintenance_records", "resolution")
