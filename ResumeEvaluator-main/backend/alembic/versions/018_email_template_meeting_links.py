"""Add meeting links and attachments to email templates

Revision ID: 018_email_template_meeting_links
Revises: 017_email_template_cc_bcc
Create Date: 2026-06-12 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018_email_template_meeting_links"
down_revision: Union[str, None] = "017_email_template_cc_bcc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # email_templates columns
    op.add_column("email_templates", sa.Column("meeting_link", sa.Text(), nullable=True))
    op.add_column("email_templates", sa.Column("meeting_cta_label", sa.String(length=128), server_default="Join Meeting", nullable=True))
    op.add_column("email_templates", sa.Column("generate_qr", sa.Boolean(), server_default="false", nullable=False))
    
    # email_template_attachments table
    op.create_table(
        "email_template_attachments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("template_key", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("file_data", sa.LargeBinary(), nullable=False),
        sa.Column("file_size", sa.Integer(), server_default="0", nullable=False),
        sa.Column("uploaded_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["template_key"], ["email_templates.key"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("email_template_attachments")
    op.drop_column("email_templates", "generate_qr")
    op.drop_column("email_templates", "meeting_cta_label")
    op.drop_column("email_templates", "meeting_link")
