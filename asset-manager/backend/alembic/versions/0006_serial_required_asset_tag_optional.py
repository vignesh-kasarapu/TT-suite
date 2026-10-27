"""Require serial_no; make asset_tag optional

Revision ID: 0006_serial_req_atag_opt
Revises: 0005_optional_serial_svc
Create Date: 2026-10-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006_serial_req_atag_opt"
down_revision: Union[str, None] = "0005_optional_serial_svc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Backfill any null serial numbers before restoring NOT NULL
    op.execute(
        sa.text(
            """
            UPDATE assets
            SET serial_no = 'SN-' || CAST(id AS TEXT)
            WHERE serial_no IS NULL OR serial_no = ''
            """
        )
    )

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("assets") as batch_op:
            batch_op.alter_column(
                "serial_no",
                existing_type=sa.String(length=255),
                nullable=False,
            )
            batch_op.alter_column(
                "asset_tag",
                existing_type=sa.String(length=255),
                nullable=True,
            )
        return

    op.alter_column(
        "assets",
        "serial_no",
        existing_type=sa.String(length=255),
        nullable=False,
    )
    op.alter_column(
        "assets",
        "asset_tag",
        existing_type=sa.String(length=255),
        nullable=True,
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE assets
            SET asset_tag = 'ATG-' || CAST(id AS TEXT)
            WHERE asset_tag IS NULL OR asset_tag = ''
            """
        )
    )

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("assets") as batch_op:
            batch_op.alter_column(
                "asset_tag",
                existing_type=sa.String(length=255),
                nullable=False,
            )
            batch_op.alter_column(
                "serial_no",
                existing_type=sa.String(length=255),
                nullable=True,
            )
        return

    op.alter_column(
        "assets",
        "asset_tag",
        existing_type=sa.String(length=255),
        nullable=False,
    )
    op.alter_column(
        "assets",
        "serial_no",
        existing_type=sa.String(length=255),
        nullable=True,
    )
