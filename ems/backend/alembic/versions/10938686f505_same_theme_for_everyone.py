"""same theme for everyone

Revision ID: 10938686f505
Revises: 6b1b545c6af8
Create Date: 2026-10-09 12:10:34.359283

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '10938686f505'
down_revision: Union[str, Sequence[str], None] = '6b1b545c6af8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Everyone uses the same design; only light/dark stays personal."""
    op.execute("UPDATE users SET preset = 'plain' WHERE preset <> 'plain'")


def downgrade() -> None:
    pass  # earlier personal choices are not kept
