"""Restrict a leave type by marital status, the way gender_eligibility already restricts by gender.

'ANY' for every existing type, so nothing changes until HR says so — and Maternity, which is
seeded as FEMALE, is set to MARRIED here because that is the rule the organisation asked for.
An employee with no marital status on record is still eligible: refusing leave over a field
nobody has filled in is worse than letting the request reach an approver (same rule the
gender check has always followed).

Revision ID: 0007_marital_eligibility
Revises: 0006_encashment_compoff_workflow
Create Date: 2026-11-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0007_marital_eligibility'
down_revision: Union[str, None] = '0006_encashment_compoff_workflow'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'leave_types',
        sa.Column('marital_eligibility', sa.String(length=10), nullable=False, server_default='ANY'),
    )
    op.execute("UPDATE leave_types SET marital_eligibility = 'MARRIED' WHERE upper(type_code) = 'MATERNITY'")


def downgrade() -> None:
    op.drop_column('leave_types', 'marital_eligibility')
