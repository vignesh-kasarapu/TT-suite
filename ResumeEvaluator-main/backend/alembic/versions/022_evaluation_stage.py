"""Per-application stage tracking on Evaluation

Candidate.stage was a single column shared across every job role the
candidate applied to. This adds an authoritative stage column on Evaluation
(one row per candidate+job_role application) and backfills it from the
candidate's current stage so nothing regresses for already-in-pipeline
candidates. Candidate.stage is kept as a derived "last-moved" convenience
column, dual-written by the application code going forward.

Revision ID: 022_evaluation_stage
Revises: 021_audit_log_details
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "022_evaluation_stage"
down_revision: Union[str, None] = "021_audit_log_details"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("stage", sa.String(32), nullable=True))

    op.execute(sa.text(
        "UPDATE evaluations e SET stage = c.stage "
        "FROM resumes r, resume_versions rv, candidates c "
        "WHERE e.resume_id = r.id AND r.id = rv.id AND rv.candidate_id = c.id "
        "AND e.stage IS NULL"
    ))
    op.execute(sa.text("UPDATE evaluations SET stage = 'applied' WHERE stage IS NULL"))

    op.alter_column("evaluations", "stage", nullable=False, server_default="applied")


def downgrade() -> None:
    op.drop_column("evaluations", "stage")
