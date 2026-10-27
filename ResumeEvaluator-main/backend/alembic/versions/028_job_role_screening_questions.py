"""Add job_role_questions table and evaluation screening answer columns

Revision ID: 028_job_role_screening_questions
Revises: 027_evaluation_cover_letter
Create Date: 2026-07-15 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "028_job_role_screening_questions"
down_revision: Union[str, None] = "027_evaluation_cover_letter"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "job_role_questions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("job_role_id", sa.Integer, sa.ForeignKey("job_roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_text", sa.Text, nullable=False),
        sa.Column("question_type", sa.String(10), nullable=False, server_default="yes_no"),
        sa.Column("is_required", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("knockout_reject_on", sa.String(10), nullable=True),
        sa.Column("order", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index(op.f("ix_job_role_questions_id"), "job_role_questions", ["id"])
    op.create_index(op.f("ix_job_role_questions_job_role_id"), "job_role_questions", ["job_role_id"])

    op.add_column("evaluations", sa.Column("screening_answers", sa.Text(), nullable=True))
    op.add_column("evaluations", sa.Column("knockout_failed", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("evaluations", "knockout_failed")
    op.drop_column("evaluations", "screening_answers")
    op.drop_index(op.f("ix_job_role_questions_job_role_id"), table_name="job_role_questions")
    op.drop_index(op.f("ix_job_role_questions_id"), table_name="job_role_questions")
    op.drop_table("job_role_questions")
