"""MANAGER_REASSIGNED names people instead of "employee #2".

The default body now says who moved and to whom, with employee codes. Only the untouched
default is replaced; a template HR has edited is left as it is. (A fresh schema gets the new
text from scripts/seed.py.)

Revision ID: 0004_manager_reassigned_names
Revises: 0003_first_manager_log
Create Date: 2026-10-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004_manager_reassigned_names'
down_revision: Union[str, None] = '0003_first_manager_log'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OLD = "A reporting-manager change has taken effect. New manager: employee #{{newManagerId}}."
NEW = "{{employeeName}} ({{employeeCode}}) now reports to {{newManagerName}} ({{newManagerCode}}). Previous manager: {{oldManagerName}}."


def _swap(old: str, new: str) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE notification_templates SET body_template = :new, updated_at = now() "
            "WHERE template_key = 'MANAGER_REASSIGNED' AND body_template = :old"
        ),
        {"old": old, "new": new},
    )


def upgrade() -> None:
    _swap(OLD, NEW)


def downgrade() -> None:
    _swap(NEW, OLD)
