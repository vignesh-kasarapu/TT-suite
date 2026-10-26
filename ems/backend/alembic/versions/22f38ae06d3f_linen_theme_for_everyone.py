"""linen theme for everyone

Revision ID: 22f38ae06d3f
Revises: 10938686f505
Create Date: 2026-10-09 12:13:49.174033

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '22f38ae06d3f'
down_revision: Union[str, Sequence[str], None] = '10938686f505'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Everyone uses the Linen design; only light/dark stays personal."""
    op.execute("UPDATE users SET preset = 'linen'")


def downgrade() -> None:
    op.execute("UPDATE users SET preset = 'plain'")
