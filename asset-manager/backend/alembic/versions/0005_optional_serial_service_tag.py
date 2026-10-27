"""Make serial_no and service_tag optional (nullable)

Revision ID: 0005_optional_serial_svc
Revises: 0004_add_service_asset_tags
Create Date: 2026-10-24 11:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005_optional_serial_svc"
down_revision: Union[str, None] = "0004_add_service_asset_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("assets") as batch_op:
            batch_op.alter_column(
                "serial_no",
                existing_type=sa.String(length=255),
                nullable=True,
            )
            batch_op.alter_column(
                "service_tag",
                existing_type=sa.String(length=255),
                nullable=True,
            )
        return

    op.alter_column(
        "assets",
        "serial_no",
        existing_type=sa.String(length=255),
        nullable=True,
    )
    op.alter_column(
        "assets",
        "service_tag",
        existing_type=sa.String(length=255),
        nullable=True,
    )


def downgrade() -> None:
    # Backfill nulls before restoring NOT NULL
    op.execute(
        sa.text(
            """
            UPDATE assets
            SET serial_no = 'SN-' || CAST(id AS TEXT)
            WHERE serial_no IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE assets
            SET service_tag = 'SVC-' || CAST(id AS TEXT)
            WHERE service_tag IS NULL
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
                "service_tag",
                existing_type=sa.String(length=255),
                nullable=False,
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
        "service_tag",
        existing_type=sa.String(length=255),
        nullable=False,
    )
