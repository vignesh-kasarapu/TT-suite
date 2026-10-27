"""Saved custom reports table

Revision ID: 026_saved_reports_table
Revises: 025_comment_parent_id
Create Date: 2026-07-14 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "026_saved_reports_table"
down_revision: Union[str, None] = "025_comment_parent_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_reports",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("config", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=True),
    )
    op.create_index(op.f("ix_saved_reports_id"), "saved_reports", ["id"])
    op.create_index(op.f("ix_saved_reports_owner_id"), "saved_reports", ["owner_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_saved_reports_owner_id"), table_name="saved_reports")
    op.drop_index(op.f("ix_saved_reports_id"), table_name="saved_reports")
    op.drop_table("saved_reports")
