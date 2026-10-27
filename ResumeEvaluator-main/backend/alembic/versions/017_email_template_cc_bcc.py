"""Add cc and bcc columns to email_templates

Revision ID: 017_email_template_cc_bcc
Revises: 016_add_share_link_stages
Create Date: 2026-06-12 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017_email_template_cc_bcc"
down_revision: Union[str, None] = "016_email_templates_table"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("email_templates", sa.Column("cc", sa.Text(), nullable=True))
    op.add_column("email_templates", sa.Column("bcc", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("email_templates", "bcc")
    op.drop_column("email_templates", "cc")
