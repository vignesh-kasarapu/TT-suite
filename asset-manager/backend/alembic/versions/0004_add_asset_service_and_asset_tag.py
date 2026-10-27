"""Add service_tag and asset_tag columns to assets

Revision ID: 0004_add_service_asset_tags
Revises: 0003_add_maintenance_opened_by
Create Date: 2026-10-24 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004_add_service_asset_tags"
down_revision: Union[str, None] = "0003_add_maintenance_opened_by"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "sqlite":
        # SQLite: ADD COLUMN supports NOT NULL only with a default; avoid ALTER constraints.
        with op.batch_alter_table("assets") as batch_op:
            batch_op.add_column(
                sa.Column(
                    "service_tag",
                    sa.String(length=255),
                    nullable=False,
                    server_default="",
                )
            )
            batch_op.add_column(
                sa.Column(
                    "asset_tag",
                    sa.String(length=255),
                    nullable=False,
                    server_default="",
                )
            )

        op.execute(
            sa.text(
                """
                UPDATE assets
                SET
                    service_tag = 'SVC-' || CAST(id AS TEXT),
                    asset_tag = 'ATG-' || CAST(id AS TEXT)
                WHERE service_tag = '' OR asset_tag = ''
                """
            )
        )

        with op.batch_alter_table("assets") as batch_op:
            batch_op.create_index("ix_assets_service_tag", ["service_tag"], unique=True)
            batch_op.create_index("ix_assets_asset_tag", ["asset_tag"], unique=True)
        return

    # PostgreSQL (and others): nullable add → backfill → NOT NULL + unique indexes
    op.add_column("assets", sa.Column("service_tag", sa.String(length=255), nullable=True))
    op.add_column("assets", sa.Column("asset_tag", sa.String(length=255), nullable=True))

    op.execute(
        sa.text(
            """
            UPDATE assets
            SET
                service_tag = 'SVC-' || CAST(id AS TEXT),
                asset_tag = 'ATG-' || CAST(id AS TEXT)
            WHERE service_tag IS NULL OR asset_tag IS NULL
            """
        )
    )

    op.alter_column("assets", "service_tag", existing_type=sa.String(length=255), nullable=False)
    op.alter_column("assets", "asset_tag", existing_type=sa.String(length=255), nullable=False)
    op.create_index("ix_assets_service_tag", "assets", ["service_tag"], unique=True)
    op.create_index("ix_assets_asset_tag", "assets", ["asset_tag"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("assets") as batch_op:
            batch_op.drop_index("ix_assets_asset_tag")
            batch_op.drop_index("ix_assets_service_tag")
            batch_op.drop_column("asset_tag")
            batch_op.drop_column("service_tag")
        return

    op.drop_index("ix_assets_asset_tag", table_name="assets")
    op.drop_index("ix_assets_service_tag", table_name="assets")
    op.drop_column("assets", "asset_tag")
    op.drop_column("assets", "service_tag")
