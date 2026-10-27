"""Add cover_letter column to evaluations

Revision ID: 027_evaluation_cover_letter
Revises: 026_saved_reports_table
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "027_evaluation_cover_letter"
down_revision: Union[str, None] = "026_saved_reports_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("cover_letter", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("evaluations", "cover_letter")
