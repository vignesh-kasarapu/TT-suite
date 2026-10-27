"""LLM provenance tracking on Evaluation

Records which model/provider/prompt-version produced each score, and whether
the embedding cross-check flagged a disagreement with the LLM's classification.
Without this, swapping LLM_MODEL leaves no trace of which model scored which
resume, making score drift impossible to audit after the fact.

Revision ID: 024_llm_provenance
Revises: 023_saved_jobs_and_eeo
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "024_llm_provenance"
down_revision: Union[str, None] = "023_saved_jobs_and_eeo"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("llm_model", sa.String(120), nullable=True))
    op.add_column("evaluations", sa.Column("llm_provider", sa.String(30), nullable=True))
    op.add_column("evaluations", sa.Column("prompt_version", sa.String(30), nullable=True))
    op.add_column("evaluations", sa.Column("scoring_method", sa.String(10), nullable=True))
    op.add_column(
        "evaluations",
        sa.Column("flagged_for_review", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("evaluations", "flagged_for_review")
    op.drop_column("evaluations", "scoring_method")
    op.drop_column("evaluations", "prompt_version")
    op.drop_column("evaluations", "llm_provider")
    op.drop_column("evaluations", "llm_model")
