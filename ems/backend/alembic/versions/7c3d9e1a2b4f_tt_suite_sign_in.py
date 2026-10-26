"""TT Suite sign-in: link users to the suite person; passwords are no longer used

Revision ID: 7c3d9e1a2b4f
Revises: 5a8e2f6c1d43
Create Date: 2026-10-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7c3d9e1a2b4f'
down_revision: Union[str, Sequence[str], None] = '5a8e2f6c1d43'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Sign-in moves to the TT Suite portal (Microsoft). `suite_user_id` is app.users.id."""
    op.add_column('users', sa.Column('suite_user_id', sa.String(length=40), nullable=True))
    op.create_unique_constraint('uq_users_suite_user_id', 'users', ['suite_user_id'])
    op.alter_column('users', 'password_hash', existing_type=sa.String(length=200), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE users SET password_hash = '' WHERE password_hash IS NULL")
    op.alter_column('users', 'password_hash', existing_type=sa.String(length=200), nullable=False)
    op.drop_constraint('uq_users_suite_user_id', 'users', type_='unique')
    op.drop_column('users', 'suite_user_id')
