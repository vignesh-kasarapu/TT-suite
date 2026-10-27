"""Add org_employees table for AD/LDAP directory sync

Revision ID: 018_org_employees
Revises: 018_email_template_meeting_links
Create Date: 2026-06-12 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018_org_employees"
down_revision: Union[str, None] = "018_email_template_meeting_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "org_employees",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("job_title", sa.String(255), nullable=True),
        sa.Column("department", sa.String(255), nullable=True),
        sa.Column("source", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("synced_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_org_employees_email", "org_employees", ["email"])


def downgrade() -> None:
    op.drop_index("ix_org_employees_email", table_name="org_employees")
    op.drop_table("org_employees")
