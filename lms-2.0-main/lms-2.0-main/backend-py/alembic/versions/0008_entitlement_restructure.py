"""Full entitlement model: shared pools, temporary restrictions, archived leave types.

Nothing here touches a balance. Historical ledger rows stay exactly as they are; the new
`pool_id` column is null on every one of them, which is correct — they were posted against
a single leave type and are still read that way.

Revision ID: 0008_entitlement_restructure
Revises: 0007_marital_eligibility
Create Date: 2026-11-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0008_entitlement_restructure'
down_revision: Union[str, None] = '0007_marital_eligibility'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- archive instead of delete -----------------------------------------------------
    op.add_column('leave_types', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('leave_types', sa.Column('archived_by', sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        'leave_types_archived_by_fkey', 'leave_types', 'users', ['archived_by'], ['user_id']
    )

    # --- shared entitlement pools ------------------------------------------------------
    op.create_table(
        'leave_entitlement_pools',
        sa.Column('pool_id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('pool_code', sa.String(length=30), nullable=False),
        sa.Column('pool_name', sa.String(length=100), nullable=False),
        sa.Column('annual_entitlement', sa.DECIMAL(precision=6, scale=1), nullable=False),
        sa.Column('carries_forward', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('carry_forward_cap', sa.DECIMAL(precision=6, scale=1), nullable=True),
        sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['updated_by'], ['users.user_id']),
        sa.PrimaryKeyConstraint('pool_id'),
        sa.UniqueConstraint('pool_code'),
    )
    op.create_table(
        'leave_type_pool_members',
        sa.Column('leave_type_id', sa.BigInteger(), nullable=False),
        sa.Column('pool_id', sa.BigInteger(), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id']),
        sa.ForeignKeyConstraint(['pool_id'], ['leave_entitlement_pools.pool_id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.user_id']),
        # One pool per leave type: the same days can never be granted twice.
        sa.PrimaryKeyConstraint('leave_type_id'),
    )
    op.create_index('ix_leave_type_pool_members_pool', 'leave_type_pool_members', ['pool_id'])

    # --- the ledger learns which pool an entry belongs to -------------------------------
    op.add_column('leave_ledger', sa.Column('pool_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        'leave_ledger_pool_id_fkey', 'leave_ledger', 'leave_entitlement_pools', ['pool_id'], ['pool_id']
    )
    op.create_index('ix_leave_ledger_pool_balance', 'leave_ledger', ['employee_id', 'pool_id', 'leave_year_id'])

    # --- temporary balance restrictions ------------------------------------------------
    op.create_table(
        'leave_balance_restrictions',
        sa.Column('restriction_id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.BigInteger(), nullable=False),
        sa.Column('leave_type_id', sa.BigInteger(), nullable=True),
        sa.Column('pool_id', sa.BigInteger(), nullable=True),
        sa.Column('leave_year_id', sa.BigInteger(), nullable=False),
        sa.Column('days', sa.DECIMAL(precision=6, scale=1), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('state', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('released_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_by', sa.BigInteger(), nullable=True),
        sa.Column('cancellation_reason', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['users.user_id']),
        sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id']),
        sa.ForeignKeyConstraint(['pool_id'], ['leave_entitlement_pools.pool_id']),
        sa.ForeignKeyConstraint(['leave_year_id'], ['leave_years.leave_year_id']),
        sa.ForeignKeyConstraint(['created_by'], ['users.user_id']),
        sa.ForeignKeyConstraint(['cancelled_by'], ['users.user_id']),
        sa.PrimaryKeyConstraint('restriction_id'),
        # Exactly one target: a pooled type is restricted at its pool.
        sa.CheckConstraint(
            '(leave_type_id IS NOT NULL AND pool_id IS NULL) OR (leave_type_id IS NULL AND pool_id IS NOT NULL)',
            name='ck_restriction_one_target',
        ),
        sa.CheckConstraint('end_date >= start_date', name='ck_restriction_date_order'),
        sa.CheckConstraint('days > 0', name='ck_restriction_days_positive'),
    )
    op.create_index(
        'ix_restrictions_employee_window', 'leave_balance_restrictions',
        ['employee_id', 'leave_year_id', 'state'],
    )


def downgrade() -> None:
    op.drop_index('ix_restrictions_employee_window', table_name='leave_balance_restrictions')
    op.drop_table('leave_balance_restrictions')
    op.drop_index('ix_leave_ledger_pool_balance', table_name='leave_ledger')
    op.drop_constraint('leave_ledger_pool_id_fkey', 'leave_ledger', type_='foreignkey')
    op.drop_column('leave_ledger', 'pool_id')
    op.drop_index('ix_leave_type_pool_members_pool', table_name='leave_type_pool_members')
    op.drop_table('leave_type_pool_members')
    op.drop_table('leave_entitlement_pools')
    op.drop_constraint('leave_types_archived_by_fkey', 'leave_types', type_='foreignkey')
    op.drop_column('leave_types', 'archived_by')
    op.drop_column('leave_types', 'archived_at')
