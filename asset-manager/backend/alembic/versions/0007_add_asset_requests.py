"""Add asset_requests table for employee asset request workflow

Revision ID: 0007_add_asset_requests
Revises: 0006_serial_req_atag_opt
Create Date: 2026-10-24 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007_add_asset_requests"
down_revision: Union[str, None] = "0006_serial_req_atag_opt"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "asset_requests",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("requested_by", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "is_other",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("other_category_name", sa.String(length=255), nullable=True),
        sa.Column("other_reason", sa.Text(), nullable=True),
        sa.Column("serial_no", sa.String(length=255), nullable=False),
        sa.Column("service_tag", sa.String(length=255), nullable=True),
        sa.Column("asset_tag", sa.String(length=255), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=False),
        sa.Column("cost", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_asset_id", sa.BigInteger(), nullable=True),
        sa.Column("decided_by", sa.BigInteger(), nullable=True),
        sa.Column("decision_comment", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_asset_id"], ["assets.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_asset_requests_requested_by"),
        "asset_requests",
        ["requested_by"],
        unique=False,
    )
    op.create_index(
        op.f("ix_asset_requests_serial_no"),
        "asset_requests",
        ["serial_no"],
        unique=False,
    )
    op.create_index(
        op.f("ix_asset_requests_status"),
        "asset_requests",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_asset_requests_status"), table_name="asset_requests")
    op.drop_index(op.f("ix_asset_requests_serial_no"), table_name="asset_requests")
    op.drop_index(op.f("ix_asset_requests_requested_by"), table_name="asset_requests")
    op.drop_table("asset_requests")
