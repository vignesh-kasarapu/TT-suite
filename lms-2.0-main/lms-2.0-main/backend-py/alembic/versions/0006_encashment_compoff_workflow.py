"""Approval workflows for leave encashment and compensatory off.

Encashment becomes REQUESTED -> POSTED | REJECTED, so the HR decision (who, when, why) has
somewhere to live and the ledger is debited only on approval.

Compensatory off becomes a two-stage request (manager, then HR) rather than a bare credit:
hours claimed, the converted days, both approvers and their comments, and the leave year the
WORK falls in. Existing rows are credits that were already final, so they are backfilled as
APPROVED with their original approver.

Ledger quantity and comp-off days widen from one decimal to two: 8 hours = 1 day makes 0.25
and 0.75 ordinary values, and at one decimal 0.25 could not be stored at all. Widening is
loss-free and changes no business rule.

Revision ID: 0006_encashment_compoff_workflow
Revises: 0005_advance_lop
Create Date: 2026-11-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0006_encashment_compoff_workflow'
down_revision: Union[str, None] = '0005_advance_lop'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- precision -------------------------------------------------------------------
    op.alter_column('leave_ledger', 'quantity', type_=sa.DECIMAL(precision=8, scale=2), existing_nullable=False)
    op.alter_column('compensatory_off_credits', 'hours_or_days', type_=sa.DECIMAL(precision=6, scale=2), existing_nullable=False)
    op.alter_column('leave_encashment_requests', 'days_encashed', type_=sa.DECIMAL(precision=6, scale=2), existing_nullable=False)

    # --- encashment: the HR decision --------------------------------------------------
    op.add_column('leave_encashment_requests', sa.Column('decided_by', sa.BigInteger(), nullable=True))
    op.add_column('leave_encashment_requests', sa.Column('decided_at', sa.DateTime(), nullable=True))
    op.add_column('leave_encashment_requests', sa.Column('decision_notes', sa.Text(), nullable=True))
    op.create_foreign_key(
        'leave_encashment_requests_decided_by_fkey', 'leave_encashment_requests', 'users', ['decided_by'], ['user_id'],
    )
    op.create_index('ix_leave_encashment_requests_status', 'leave_encashment_requests', ['status'])

    # --- comp-off: a two-stage request ------------------------------------------------
    op.add_column('compensatory_off_credits', sa.Column('hours_worked', sa.DECIMAL(precision=6, scale=2), nullable=True))
    op.add_column('compensatory_off_credits', sa.Column('leave_year_id', sa.BigInteger(), nullable=True))
    op.add_column('compensatory_off_credits', sa.Column('status', sa.String(length=20), nullable=False, server_default='APPROVED'))
    op.add_column('compensatory_off_credits', sa.Column('requested_by', sa.BigInteger(), nullable=True))
    op.add_column('compensatory_off_credits', sa.Column('manager_id', sa.BigInteger(), nullable=True))
    op.add_column('compensatory_off_credits', sa.Column('manager_decided_at', sa.DateTime(), nullable=True))
    op.add_column('compensatory_off_credits', sa.Column('manager_comments', sa.Text(), nullable=True))
    op.add_column('compensatory_off_credits', sa.Column('hr_id', sa.BigInteger(), nullable=True))
    op.add_column('compensatory_off_credits', sa.Column('hr_decided_at', sa.DateTime(), nullable=True))
    op.add_column('compensatory_off_credits', sa.Column('hr_comments', sa.Text(), nullable=True))
    # A request has no approver until HR acts, so the column can no longer be NOT NULL.
    op.alter_column('compensatory_off_credits', 'approved_by', existing_type=sa.BigInteger(), nullable=True)
    for column in ('leave_year_id', 'requested_by', 'manager_id', 'hr_id'):
        target = 'leave_years' if column == 'leave_year_id' else 'users'
        target_col = 'leave_year_id' if column == 'leave_year_id' else 'user_id'
        op.create_foreign_key(
            f'compensatory_off_credits_{column}_fkey', 'compensatory_off_credits', target, [column], [target_col],
        )
    op.create_index('ix_compensatory_off_credits_status', 'compensatory_off_credits', ['status'])

    # Rows that pre-date the workflow were credits posted straight away: final, HR-approved,
    # and already on the ledger. Record them as such rather than leaving them stateless.
    op.execute(
        """
        UPDATE compensatory_off_credits
           SET status = 'APPROVED',
               hr_id = COALESCE(hr_id, approved_by),
               hr_decided_at = COALESCE(hr_decided_at, created_at),
               requested_by = COALESCE(requested_by, employee_id),
               leave_year_id = COALESCE(leave_year_id, (
                   SELECT ly.leave_year_id FROM leave_years ly
                    WHERE compensatory_off_credits.work_date BETWEEN ly.start_date AND ly.end_date
                    LIMIT 1
               ))
        """
    )


def downgrade() -> None:
    op.drop_index('ix_compensatory_off_credits_status', table_name='compensatory_off_credits')
    for column in ('leave_year_id', 'requested_by', 'manager_id', 'hr_id'):
        op.drop_constraint(f'compensatory_off_credits_{column}_fkey', 'compensatory_off_credits', type_='foreignkey')
    op.alter_column('compensatory_off_credits', 'approved_by', existing_type=sa.BigInteger(), nullable=False)
    for column in (
        'hr_comments', 'hr_decided_at', 'hr_id', 'manager_comments', 'manager_decided_at', 'manager_id',
        'requested_by', 'status', 'leave_year_id', 'hours_worked',
    ):
        op.drop_column('compensatory_off_credits', column)

    op.drop_index('ix_leave_encashment_requests_status', table_name='leave_encashment_requests')
    op.drop_constraint('leave_encashment_requests_decided_by_fkey', 'leave_encashment_requests', type_='foreignkey')
    for column in ('decision_notes', 'decided_at', 'decided_by'):
        op.drop_column('leave_encashment_requests', column)

    op.alter_column('leave_encashment_requests', 'days_encashed', type_=sa.DECIMAL(precision=6, scale=1), existing_nullable=False)
    op.alter_column('compensatory_off_credits', 'hours_or_days', type_=sa.DECIMAL(precision=6, scale=1), existing_nullable=False)
    op.alter_column('leave_ledger', 'quantity', type_=sa.DECIMAL(precision=8, scale=1), existing_nullable=False)
