"""roles instead of grades

Revision ID: 5a8e2f6c1d43
Revises: 8242518cad80
Create Date: 2026-10-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5a8e2f6c1d43'
down_revision: Union[str, Sequence[str], None] = '8242518cad80'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Grades go: self-approval and cash advances follow the role (Manager or Admin).
    Level 1 is always the reporting manager, so the per-category Level 1 approver goes too."""
    op.execute("DELETE FROM policy_limits WHERE scope = 'GRADE'")
    op.drop_column('users', 'grade_code')
    op.drop_table('grades')
    op.drop_column('categories', 'level1_approver_id')


def downgrade() -> None:
    op.add_column('categories', sa.Column('level1_approver_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True))
    op.create_table(
        'grades',
        sa.Column('code', sa.String(length=20), primary_key=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('rank', sa.Integer(), nullable=False),
        sa.Column('can_self_approve', sa.Boolean(), nullable=False),
        sa.Column('can_request_advance', sa.Boolean(), nullable=False),
    )
    op.add_column('users', sa.Column('grade_code', sa.String(length=20), sa.ForeignKey('grades.code'), nullable=True))
