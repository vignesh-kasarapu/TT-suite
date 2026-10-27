"""Add share_token/is_shared to saved_reports

Revision ID: 033_saved_report_sharing
Revises: 032_candidate_tags
Create Date: 2026-08-25 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "033_saved_report_sharing"
down_revision: Union[str, None] = "032_candidate_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saved_reports",
        sa.Column("share_token", sa.String(64), nullable=True),
    )
    op.create_unique_constraint(
        "uq_saved_reports_share_token", "saved_reports", ["share_token"]
    )
    op.add_column(
        "saved_reports",
        sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("saved_reports", "is_shared")
    op.drop_constraint("uq_saved_reports_share_token", "saved_reports", type_="unique")
    op.drop_column("saved_reports", "share_token")
