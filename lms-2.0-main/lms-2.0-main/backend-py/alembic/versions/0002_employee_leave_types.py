"""Leave types that do not apply to an employee.

HR unticks a leave type for a person in Edit employee: it leaves their dashboard and Apply
picker, and a request for it is refused. A row here means "not applicable"; no rows means
every selectable type applies, so existing employees and newly added leave types need nothing.

Revision ID: 0002_employee_leave_types
Revises: 0001_initial
Create Date: 2026-10-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002_employee_leave_types'
down_revision: Union[str, None] = '0001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('employee_leave_type_exclusions',
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('leave_type_id', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('employee_id', 'leave_type_id')
    )


def downgrade() -> None:
    op.drop_table('employee_leave_type_exclusions')
