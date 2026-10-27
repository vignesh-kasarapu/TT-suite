"""Simplify asset requests to category+reason; employee one-time full details

Revision ID: 0009_req_reason_emp_fill
Revises: 0008_prefix_ams_tables
Create Date: 2026-10-24 16:45:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_req_reason_emp_fill"
down_revision: Union[str, None] = "0008_prefix_ams_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ams_assets",
        sa.Column(
            "awaiting_employee_details",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )

    op.add_column(
        "ams_asset_requests",
        sa.Column("reason", sa.Text(), nullable=True),
    )
    op.execute(
        """
        UPDATE ams_asset_requests
        SET reason = COALESCE(NULLIF(TRIM(other_reason), ''), 'Legacy asset request')
        WHERE reason IS NULL
        """
    )
    op.alter_column("ams_asset_requests", "reason", nullable=False)

    op.alter_column("ams_asset_requests", "serial_no", existing_type=sa.String(255), nullable=True)
    op.alter_column("ams_asset_requests", "purchase_date", existing_type=sa.Date(), nullable=True)
    op.alter_column(
        "ams_asset_requests",
        "cost",
        existing_type=sa.Numeric(12, 2),
        nullable=True,
    )
    op.alter_column("ams_asset_requests", "location", existing_type=sa.String(255), nullable=True)


def downgrade() -> None:
    op.execute(
        """
        UPDATE ams_asset_requests
        SET serial_no = COALESCE(serial_no, 'LEGACY-' || id::text),
            purchase_date = COALESCE(purchase_date, CURRENT_DATE),
            cost = COALESCE(cost, 0),
            location = COALESCE(location, 'Unknown')
        """
    )
    op.alter_column("ams_asset_requests", "serial_no", existing_type=sa.String(255), nullable=False)
    op.alter_column("ams_asset_requests", "purchase_date", existing_type=sa.Date(), nullable=False)
    op.alter_column(
        "ams_asset_requests",
        "cost",
        existing_type=sa.Numeric(12, 2),
        nullable=False,
    )
    op.alter_column("ams_asset_requests", "location", existing_type=sa.String(255), nullable=False)

    op.drop_column("ams_asset_requests", "reason")
    op.drop_column("ams_assets", "awaiting_employee_details")
