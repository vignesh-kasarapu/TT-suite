"""Add stages column to share_links table

Revision ID: 016_add_share_link_stages
Revises: 015_share_links
Create Date: 2026-06-09 11:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016_add_share_link_stages"
down_revision: Union[str, None] = "015_share_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("share_links", sa.Column("stages", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("share_links", "stages")
