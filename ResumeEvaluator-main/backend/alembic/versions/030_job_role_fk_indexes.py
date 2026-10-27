"""Add indexes on job_role_id/job_id foreign keys to speed up cascading deletes

Revision ID: 030_job_role_fk_indexes
Revises: 029_job_role_archived
Create Date: 2026-07-16 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "030_job_role_fk_indexes"
down_revision: Union[str, None] = "029_job_role_archived"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES = [
    ("ix_job_role_requirements_job_role_id", "job_role_requirements", "job_role_id"),
    ("ix_job_role_questions_job_role_id", "job_role_questions", "job_role_id"),
    ("ix_job_role_skills_job_role_id", "job_role_skills", "job_role_id"),
    ("ix_candidate_saved_jobs_job_role_id", "candidate_saved_jobs", "job_role_id"),
    ("ix_evaluations_job_role_id", "evaluations", "job_role_id"),
    ("ix_share_links_job_role_id", "share_links", "job_role_id"),
    ("ix_inbound_emails_job_id", "inbound_emails", "job_id"),
]


def upgrade() -> None:
    for index_name, table_name, column_name in _INDEXES:
        op.create_index(index_name, table_name, [column_name], if_not_exists=True)


def downgrade() -> None:
    for index_name, table_name, _column_name in _INDEXES:
        op.drop_index(index_name, table_name=table_name)
