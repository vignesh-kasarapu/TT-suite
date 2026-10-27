"""Initial schema covering all 6 tables, asset_tag_seq, indexes, and seed data

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-10-19 12:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.schema import CreateSequence, DropSequence, Sequence as SASequence

# revision identifiers, used by Alembic.
revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name

    # 0. Sequence for AST-0001 auto-generated tags (PostgreSQL)
    if dialect_name == "postgresql":
        op.execute(CreateSequence(SASequence("asset_tag_seq", start=1, increment=1)))

    pk_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")

    # 1. users table
    users_table = op.create_table(
        "users",
        sa.Column("id", pk_type, primary_key=True, autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=50), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # 2. categories table
    categories_table = op.create_table(
        "categories",
        sa.Column("id", pk_type, primary_key=True, autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("name", name="uq_categories_name"),
    )

    # 3. assets table
    op.create_table(
        "assets",
        sa.Column("id", pk_type, primary_key=True, autoincrement=True, nullable=False),
        sa.Column("tag", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("serial_no", sa.String(length=255), nullable=False),
        sa.Column("category_id", pk_type, nullable=False),
        sa.Column("purchase_date", sa.Date(), nullable=False),
        sa.Column("cost", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("serial_no", name="uq_assets_serial_no"),
    )
    op.create_index("ix_assets_tag", "assets", ["tag"], unique=True)
    op.create_index("ix_assets_name", "assets", ["name"], unique=False)
    op.create_index("ix_assets_category_id", "assets", ["category_id"], unique=False)
    op.create_index("ix_assets_status", "assets", ["status"], unique=False)

    # 4. assignments table
    op.create_table(
        "assignments",
        sa.Column("id", pk_type, primary_key=True, autoincrement=True, nullable=False),
        sa.Column("asset_id", pk_type, nullable=False),
        sa.Column("user_id", pk_type, nullable=False),
        sa.Column("assigned_on", sa.Date(), nullable=False),
        sa.Column("returned_on", sa.Date(), nullable=True),
        sa.Column("return_reason", sa.String(length=50), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_assignments_asset_id", "assignments", ["asset_id"], unique=False)
    op.create_index("ix_assignments_user_id", "assignments", ["user_id"], unique=False)
    op.create_index(
        "uq_assignments_open_asset",
        "assignments",
        ["asset_id"],
        unique=True,
        postgresql_where=sa.text("returned_on IS NULL"),
        sqlite_where=sa.text("returned_on IS NULL"),
    )

    # 5. replacement_requests table
    op.create_table(
        "replacement_requests",
        sa.Column("id", pk_type, primary_key=True, autoincrement=True, nullable=False),
        sa.Column("asset_id", pk_type, nullable=False),
        sa.Column("requested_by", pk_type, nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("old_asset_action", sa.String(length=50), nullable=False),
        sa.Column("temporary", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("replacement_asset_id", pk_type, nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("decided_by", pk_type, nullable=True),
        sa.Column("decision_comment", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["requested_by"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["replacement_asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="RESTRICT"),
    )
    op.create_index("ix_replacement_requests_asset_id", "replacement_requests", ["asset_id"], unique=False)
    op.create_index("ix_replacement_requests_requested_by", "replacement_requests", ["requested_by"], unique=False)
    op.create_index("ix_replacement_requests_status", "replacement_requests", ["status"], unique=False)

    # 6. maintenance_records table
    op.create_table(
        "maintenance_records",
        sa.Column("id", pk_type, primary_key=True, autoincrement=True, nullable=False),
        sa.Column("asset_id", pk_type, nullable=False),
        sa.Column("replacement_request_id", pk_type, nullable=True),
        sa.Column("opened_on", sa.Date(), nullable=False),
        sa.Column("closed_on", sa.Date(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("cost", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["asset_id"], ["assets.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["replacement_request_id"],
            ["replacement_requests.id"],
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_maintenance_records_asset_id", "maintenance_records", ["asset_id"], unique=False)

    # 7. Seed default categories. (TT Suite: no demo users with fixed passwords; people come
    #    from the portal and get their AMS user on first visit.)
    op.bulk_insert(
        categories_table,
        [
            {"name": "Laptop"},
            {"name": "Monitor"},
            {"name": "Phone"},
            {"name": "Furniture"},
        ],
    )


def downgrade() -> None:
    bind = op.get_bind()
    dialect_name = bind.dialect.name

    op.drop_index("ix_maintenance_records_asset_id", table_name="maintenance_records")
    op.drop_table("maintenance_records")

    op.drop_index("ix_replacement_requests_status", table_name="replacement_requests")
    op.drop_index("ix_replacement_requests_requested_by", table_name="replacement_requests")
    op.drop_index("ix_replacement_requests_asset_id", table_name="replacement_requests")
    op.drop_table("replacement_requests")

    op.drop_index("uq_assignments_open_asset", table_name="assignments")
    op.drop_index("ix_assignments_user_id", table_name="assignments")
    op.drop_index("ix_assignments_asset_id", table_name="assignments")
    op.drop_table("assignments")

    op.drop_index("ix_assets_status", table_name="assets")
    op.drop_index("ix_assets_category_id", table_name="assets")
    op.drop_index("ix_assets_name", table_name="assets")
    op.drop_index("ix_assets_tag", table_name="assets")
    op.drop_table("assets")

    op.drop_table("categories")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    if dialect_name == "postgresql":
        op.execute(DropSequence(SASequence("asset_tag_seq")))
