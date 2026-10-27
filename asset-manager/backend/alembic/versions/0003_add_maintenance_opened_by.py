"""Add opened_by to maintenance_records

Revision ID: 0003_add_maintenance_opened_by
Revises: 0002_add_maintenance_resolution
Create Date: 2026-10-24 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_add_maintenance_opened_by"
down_revision: Union[str, None] = "0002_add_maintenance_resolution"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pk_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    bind = op.get_bind()

    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("maintenance_records") as batch_op:
            batch_op.add_column(sa.Column("opened_by", pk_type, nullable=True))
            batch_op.create_foreign_key(
                "fk_maintenance_records_opened_by_users",
                "users",
                ["opened_by"],
                ["id"],
                ondelete="SET NULL",
            )
        return

    op.add_column(
        "maintenance_records",
        sa.Column("opened_by", pk_type, nullable=True),
    )
    op.create_foreign_key(
        "fk_maintenance_records_opened_by_users",
        "maintenance_records",
        "users",
        ["opened_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("maintenance_records") as batch_op:
            batch_op.drop_constraint(
                "fk_maintenance_records_opened_by_users",
                type_="foreignkey",
            )
            batch_op.drop_column("opened_by")
        return

    op.drop_constraint(
        "fk_maintenance_records_opened_by_users",
        "maintenance_records",
        type_="foreignkey",
    )
    op.drop_column("maintenance_records", "opened_by")
