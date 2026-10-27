"""Add tags column to candidates

Revision ID: 032_candidate_tags
Revises: 031_job_role_max_experience
Create Date: 2026-07-23 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "032_candidate_tags"
down_revision: Union[str, None] = "031_job_role_max_experience"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "candidates",
        sa.Column("tags", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("candidates", "tags")
