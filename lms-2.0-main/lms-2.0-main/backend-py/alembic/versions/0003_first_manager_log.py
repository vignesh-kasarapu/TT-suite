"""A first reporting manager can be logged.

manager_reassignment_log.old_manager_id becomes nullable: giving someone their first reporting
manager (every new joiner has none) failed on it with a 409 "A record with these values already
exists". Its own revision, because databases already at 0002 must get it too.

Revision ID: 0003_first_manager_log
Revises: 0002_employee_leave_types
Create Date: 2026-10-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003_first_manager_log'
down_revision: Union[str, None] = '0002_employee_leave_types'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('manager_reassignment_log', 'old_manager_id', existing_type=sa.BigInteger(), nullable=True)


def downgrade() -> None:
    op.alter_column('manager_reassignment_log', 'old_manager_id', existing_type=sa.BigInteger(), nullable=False)
