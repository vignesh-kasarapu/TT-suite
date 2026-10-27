"""Add job listing metadata to job_roles and interview scheduling to evaluations

Revision ID: 014_listing_meta
Revises: 013_github_and_manual_eval
Create Date: 2026-06-04 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014_listing_meta"
down_revision: Union[str, None] = "013_github_and_manual_eval"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    job_role_cols = [col["name"] for col in inspector.get_columns("job_roles")]
    eval_cols = [col["name"] for col in inspector.get_columns("evaluations")]

    # ── job_roles: public listing metadata ───────────────────────────────────
    if "work_type" not in job_role_cols:
        op.add_column("job_roles", sa.Column("work_type", sa.String(50), nullable=True))

    if "job_location" not in job_role_cols:
        op.add_column("job_roles", sa.Column("job_location", sa.String(255), nullable=True))

    if "salary_min" not in job_role_cols:
        op.add_column("job_roles", sa.Column("salary_min", sa.Integer(), nullable=True))

    if "salary_max" not in job_role_cols:
        op.add_column("job_roles", sa.Column("salary_max", sa.Integer(), nullable=True))

    if "department" not in job_role_cols:
        op.add_column("job_roles", sa.Column("department", sa.String(100), nullable=True))

    if "employment_type" not in job_role_cols:
        op.add_column("job_roles", sa.Column("employment_type", sa.String(50), nullable=True))

    # ── evaluations: interview scheduling ────────────────────────────────────
    if "interview_scheduled_at" not in eval_cols:
        op.add_column("evaluations", sa.Column("interview_scheduled_at", sa.DateTime(), nullable=True))

    if "interview_link" not in eval_cols:
        op.add_column("evaluations", sa.Column("interview_link", sa.String(500), nullable=True))

    # ── evaluations: experience sub-score (may already exist from 012) ───────
    if "experience_score" not in eval_cols:
        op.add_column(
            "evaluations",
            sa.Column("experience_score", sa.Float(), nullable=False, server_default="0.0"),
        )


def downgrade() -> None:
    op.drop_column("job_roles", "work_type")
    op.drop_column("job_roles", "job_location")
    op.drop_column("job_roles", "salary_min")
    op.drop_column("job_roles", "salary_max")
    op.drop_column("job_roles", "department")
    op.drop_column("job_roles", "employment_type")
    op.drop_column("evaluations", "interview_scheduled_at")
    op.drop_column("evaluations", "interview_link")
