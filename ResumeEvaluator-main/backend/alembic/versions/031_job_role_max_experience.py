"""Add max_experience column to job_roles

Revision ID: 031_job_role_max_experience
Revises: 030_job_role_fk_indexes
Create Date: 2026-07-16 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "031_job_role_max_experience"
down_revision: Union[str, None] = "030_job_role_fk_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "job_roles",
        sa.Column("max_experience", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("job_roles", "max_experience")
