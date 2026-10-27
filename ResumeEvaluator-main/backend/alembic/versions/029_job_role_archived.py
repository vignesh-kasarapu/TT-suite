"""Add is_archived column to job_roles

Revision ID: 029_job_role_archived
Revises: 028_job_role_screening_questions
Create Date: 2026-07-16 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "029_job_role_archived"
down_revision: Union[str, None] = "028_job_role_screening_questions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "job_roles",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("job_roles", "is_archived")
