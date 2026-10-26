"""plain preset default

Revision ID: fc84aae7064a
Revises: 6ef6cfe03969
Create Date: 2026-10-08 16:06:57.853728

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fc84aae7064a'
down_revision: Union[str, Sequence[str], None] = '6ef6cfe03969'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """The wireframe look ("plain") becomes everyone's default theme."""
    op.execute("UPDATE users SET preset = 'plain' WHERE preset = 'linen'")


def downgrade() -> None:
    op.execute("UPDATE users SET preset = 'linen' WHERE preset = 'plain'")
