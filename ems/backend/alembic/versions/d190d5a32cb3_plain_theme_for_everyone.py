"""plain theme for everyone

Revision ID: d190d5a32cb3
Revises: 22f38ae06d3f
Create Date: 2026-10-09 12:17:46.671230

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd190d5a32cb3'
down_revision: Union[str, Sequence[str], None] = '22f38ae06d3f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Back to the Plain (wireframe) design for everyone."""
    op.execute("UPDATE users SET preset = 'plain'")


def downgrade() -> None:
    op.execute("UPDATE users SET preset = 'linen'")
