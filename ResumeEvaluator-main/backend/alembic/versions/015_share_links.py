"""Add share_links table for token-gated hiring manager views

Revision ID: 015_share_links
Revises: 014_listing_meta
Create Date: 2026-06-08 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015_share_links"
down_revision: Union[str, None] = "014_listing_meta"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "share_links",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("token", sa.String(64), unique=True, nullable=False, index=True),
        sa.Column("job_role_id", sa.Integer, sa.ForeignKey("job_roles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("evaluation_ids", sa.Text, nullable=True),
        sa.Column("recipient_name", sa.String(255), nullable=True),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime, nullable=True),
        sa.Column("votes", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_table("share_links")
