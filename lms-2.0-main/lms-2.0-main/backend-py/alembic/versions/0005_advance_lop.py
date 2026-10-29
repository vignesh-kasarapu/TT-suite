"""Approved advance leave: the days beyond the balance are loss of pay, the employee decides.

lop_days: days beyond the balance; lop_status: PENDING (awaiting the employee, 24 h) | CONFIRMED |
WITHDRAWN; lop_decision_deadline: when PENDING turns CONFIRMED by itself.

Revision ID: 0005_advance_lop
Revises: 0004_manager_reassigned_names
Create Date: 2026-10-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005_advance_lop'
down_revision: Union[str, None] = '0004_manager_reassigned_names'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('leave_requests', sa.Column('lop_days', sa.DECIMAL(precision=6, scale=1), nullable=True))
    op.add_column('leave_requests', sa.Column('lop_status', sa.String(length=20), nullable=True))
    op.add_column('leave_requests', sa.Column('lop_decision_deadline', sa.DateTime(), nullable=True))
    op.create_index('ix_leave_requests_lop_status', 'leave_requests', ['lop_status'])


def downgrade() -> None:
    op.drop_index('ix_leave_requests_lop_status', table_name='leave_requests')
    op.drop_column('leave_requests', 'lop_decision_deadline')
    op.drop_column('leave_requests', 'lop_status')
    op.drop_column('leave_requests', 'lop_days')
