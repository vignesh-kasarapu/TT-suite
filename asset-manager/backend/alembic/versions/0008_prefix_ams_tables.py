"""Rename all AMS tables (and asset tag sequence) with ams_ prefix

Revision ID: 0008_prefix_ams_tables
Revises: 0007_add_asset_requests
Create Date: 2026-10-24 13:30:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008_prefix_ams_tables"
down_revision: Union[str, None] = "0007_add_asset_requests"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Order does not matter for PostgreSQL rename (FKs follow relation OID).
TABLE_RENAMES: list[tuple[str, str]] = [
    ("users", "ams_users"),
    ("categories", "ams_categories"),
    ("assets", "ams_assets"),
    ("assignments", "ams_assignments"),
    ("replacement_requests", "ams_replacement_requests"),
    ("maintenance_records", "ams_maintenance_records"),
    ("asset_requests", "ams_asset_requests"),
]


def upgrade() -> None:
    bind = op.get_bind()
    for old_name, new_name in TABLE_RENAMES:
        op.rename_table(old_name, new_name)

    if bind.dialect.name == "postgresql":
        op.execute("ALTER SEQUENCE IF EXISTS asset_tag_seq RENAME TO ams_asset_tag_seq")
        op.execute(
            "ALTER INDEX IF EXISTS uq_assignments_open_asset "
            "RENAME TO uq_ams_assignments_open_asset"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(
            "ALTER INDEX IF EXISTS uq_ams_assignments_open_asset "
            "RENAME TO uq_assignments_open_asset"
        )
        op.execute("ALTER SEQUENCE IF EXISTS ams_asset_tag_seq RENAME TO asset_tag_seq")

    for old_name, new_name in reversed(TABLE_RENAMES):
        op.rename_table(new_name, old_name)
