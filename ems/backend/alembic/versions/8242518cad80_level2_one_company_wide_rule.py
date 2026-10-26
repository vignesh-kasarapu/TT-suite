"""level2 one company-wide rule

Revision ID: 8242518cad80
Revises: d190d5a32cb3
Create Date: 2026-10-09 16:39:52.827054

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8242518cad80'
down_revision: Union[str, Sequence[str], None] = 'd190d5a32cb3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Level 2 is one company-wide rule (above ₹20,000 -> second approver), no longer per category.

    The person used most in the old per-category ranges becomes the second approver. Claims already
    submitted keep the rules they were submitted with (stored on each line).
    """
    op.execute("""
        INSERT INTO app_settings (key, value)
        SELECT 'level2_approver_id', to_jsonb(approver_id) FROM level2_ranges
        GROUP BY approver_id ORDER BY count(*) DESC LIMIT 1
        ON CONFLICT (key) DO NOTHING
    """)
    op.execute("""
        INSERT INTO app_settings (key, value)
        SELECT 'level2_above', '20000'::jsonb WHERE EXISTS (SELECT 1 FROM level2_ranges)
        ON CONFLICT (key) DO NOTHING
    """)
    op.drop_table('level2_ranges')


def downgrade() -> None:
    op.create_table('level2_ranges',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('category_id', sa.Integer(), nullable=False),
    sa.Column('min_amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('max_amount', sa.Numeric(precision=12, scale=2), nullable=True),
    sa.Column('approver_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['approver_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['category_id'], ['categories.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.execute("DELETE FROM app_settings WHERE key IN ('level2_above', 'level2_approver_id')")
