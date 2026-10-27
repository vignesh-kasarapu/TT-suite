"""Add requires_employee_register flag on asset requests

Revision ID: 0010_req_emp_register_flag
Revises: 0009_req_reason_emp_fill
Create Date: 2026-10-24 22:10:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_req_emp_register_flag"
down_revision: Union[str, None] = "0009_req_reason_emp_fill"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "ams_asset_requests",
        sa.Column(
            "requires_employee_register",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("ams_asset_requests", "requires_employee_register")
