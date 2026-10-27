"""Threaded comments: add parent_id to candidate_comments

Revision ID: 025_comment_parent_id
Revises: 024_notifications_table
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "025_comment_parent_id"
down_revision: Union[str, None] = "024_notifications_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "candidate_comments",
        sa.Column(
            "parent_id",
            sa.Integer,
            sa.ForeignKey("candidate_comments.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index(
        op.f("ix_candidate_comments_parent_id"), "candidate_comments", ["parent_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_candidate_comments_parent_id"), table_name="candidate_comments")
    op.drop_column("candidate_comments", "parent_id")
