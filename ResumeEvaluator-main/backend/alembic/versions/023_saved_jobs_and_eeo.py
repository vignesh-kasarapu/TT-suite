"""Candidate saved jobs (bookmarks) + optional EEO self-identification fields

Revision ID: 023_saved_jobs_and_eeo
Revises: 022_evaluation_stage
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "023_saved_jobs_and_eeo"
down_revision: Union[str, None] = "022_evaluation_stage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "candidate_saved_jobs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("candidate_id", sa.Integer, sa.ForeignKey("candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_role_id", sa.Integer, sa.ForeignKey("job_roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("candidate_id", "job_role_id", name="uq_saved_job_candidate_role"),
    )

    op.add_column("candidates", sa.Column("gender_identity", sa.String(50), nullable=True))
    op.add_column("candidates", sa.Column("ethnicity", sa.String(50), nullable=True))
    op.add_column("candidates", sa.Column("veteran_status", sa.String(50), nullable=True))
    op.add_column("candidates", sa.Column("disability_status", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("candidates", "disability_status")
    op.drop_column("candidates", "veteran_status")
    op.drop_column("candidates", "ethnicity")
    op.drop_column("candidates", "gender_identity")
    op.drop_table("candidate_saved_jobs")
