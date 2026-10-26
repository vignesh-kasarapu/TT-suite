"""Initial PostgreSQL schema for LMS 2.0 in the TT Suite (schema `lms`).

Replaces the two MySQL-era revisions (3cc712630376 initial schema, a1b2c3d4e5f6
leave-type gender eligibility): LMS starts fresh in the suite, so there is one
baseline. Tables are created in the connection's search_path (`lms`, see
alembic/env.py); `users.suite_user_id` links an employee to app.users.id.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('departments',
    sa.Column('department_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('department_code', sa.String(length=30), nullable=False),
    sa.Column('department_name', sa.String(length=100), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('department_id'),
    sa.UniqueConstraint('department_code')
    )
    op.create_table('grades',
    sa.Column('grade_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('grade_code', sa.String(length=30), nullable=False),
    sa.Column('grade_name', sa.String(length=100), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('grade_id'),
    sa.UniqueConstraint('grade_code')
    )
    op.create_table('leave_types',
    sa.Column('leave_type_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('type_code', sa.String(length=30), nullable=False),
    sa.Column('type_name', sa.String(length=100), nullable=False),
    sa.Column('is_sick_leave', sa.Boolean(), nullable=False),
    sa.Column('is_balance_affecting', sa.Boolean(), nullable=False),
    sa.Column('is_system', sa.Boolean(), nullable=False),
    sa.Column('is_selectable_by_employee', sa.Boolean(), nullable=False),
    sa.Column('permits_half_day', sa.Boolean(), nullable=False),
    sa.Column('permits_attachments', sa.Boolean(), nullable=False),
    sa.Column('gender_eligibility', sa.String(length=10), server_default='ALL', nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('leave_type_id'),
    sa.UniqueConstraint('type_code')
    )
    op.create_table('leave_years',
    sa.Column('leave_year_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('year_code', sa.String(length=10), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=False),
    sa.Column('is_current', sa.Boolean(), nullable=False),
    sa.Column('is_closed', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('leave_year_id'),
    sa.UniqueConstraint('year_code')
    )
    op.create_table('management_levels',
    sa.Column('management_level_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('level_code', sa.String(length=30), nullable=False),
    sa.Column('level_name', sa.String(length=100), nullable=False),
    sa.Column('level_rank', sa.Integer(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('management_level_id'),
    sa.UniqueConstraint('level_code'),
    sa.UniqueConstraint('level_rank')
    )
    op.create_table('projects',
    sa.Column('project_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('project_code', sa.String(length=50), nullable=False),
    sa.Column('project_name', sa.String(length=200), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('project_id'),
    sa.UniqueConstraint('project_code')
    )
    op.create_table('regions',
    sa.Column('region_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('region_code', sa.String(length=30), nullable=False),
    sa.Column('region_name', sa.String(length=100), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('region_id'),
    sa.UniqueConstraint('region_code')
    )
    op.create_table('roles',
    sa.Column('role_id', sa.SmallInteger(), autoincrement=True, nullable=False),
    sa.Column('role_code', sa.String(length=30), nullable=False),
    sa.Column('role_name', sa.String(length=50), nullable=False),
    sa.Column('description', sa.String(length=200), nullable=True),
    sa.PrimaryKeyConstraint('role_id'),
    sa.UniqueConstraint('role_code')
    )
    op.create_table('scheduled_job_runs',
    sa.Column('job_run_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('job_type', sa.String(length=40), nullable=False),
    sa.Column('period_key', sa.String(length=50), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('started_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('finished_at', sa.DateTime(), nullable=True),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('job_run_id'),
    sa.UniqueConstraint('job_type', 'period_key', name='uq_job_type_period_key')
    )
    op.create_table('working_patterns',
    sa.Column('working_pattern_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('pattern_code', sa.String(length=30), nullable=False),
    sa.Column('pattern_name', sa.String(length=100), nullable=False),
    sa.Column('weekend_days', sa.String(length=50), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('working_pattern_id'),
    sa.UniqueConstraint('pattern_code')
    )
    op.create_table('users',
    sa.Column('user_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('entra_oid', sa.String(length=64), nullable=True),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('employee_code', sa.String(length=50), nullable=False),
    sa.Column('suite_user_id', sa.Text(), nullable=True),
    sa.Column('first_name', sa.String(length=100), nullable=True),
    sa.Column('last_name', sa.String(length=100), nullable=True),
    sa.Column('joined_date', sa.Date(), nullable=False),
    sa.Column('department_id', sa.BigInteger(), nullable=True),
    sa.Column('grade_id', sa.BigInteger(), nullable=True),
    sa.Column('management_level_id', sa.BigInteger(), nullable=True),
    sa.Column('region_id', sa.BigInteger(), nullable=True),
    sa.Column('gender', sa.String(length=10), nullable=True),
    sa.Column('marital_status', sa.String(length=20), nullable=True),
    sa.Column('designation', sa.String(length=100), nullable=True),
    sa.Column('manager_id', sa.BigInteger(), nullable=True),
    sa.Column('phone', sa.String(length=30), nullable=True),
    sa.Column('personal_email', sa.String(length=255), nullable=True),
    sa.Column('date_of_birth', sa.Date(), nullable=True),
    sa.Column('emergency_contact_name', sa.String(length=150), nullable=True),
    sa.Column('emergency_contact_phone', sa.String(length=30), nullable=True),
    sa.Column('avatar_path', sa.String(length=500), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('deactivated_date', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['department_id'], ['departments.department_id'], ),
    sa.ForeignKeyConstraint(['grade_id'], ['grades.grade_id'], ),
    sa.ForeignKeyConstraint(['management_level_id'], ['management_levels.management_level_id'], ),
    sa.ForeignKeyConstraint(['manager_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['region_id'], ['regions.region_id'], ),
    sa.PrimaryKeyConstraint('user_id'),
    sa.UniqueConstraint('entra_oid'),
    sa.UniqueConstraint('suite_user_id')
    )
    op.create_index('ux_users_email_lower', 'users', [sa.text('lower(email)')], unique=True)
    op.create_index('ux_users_employee_code_lower', 'users', [sa.text('lower(employee_code)')], unique=True)
    op.create_table('audit_log',
    sa.Column('audit_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('actor_id', sa.BigInteger(), nullable=True),
    sa.Column('is_system_actor', sa.Boolean(), nullable=False),
    sa.Column('action', sa.String(length=80), nullable=False),
    sa.Column('entity_type', sa.String(length=50), nullable=False),
    sa.Column('entity_id', sa.String(length=50), nullable=False),
    sa.Column('prior_value', sa.Text(), nullable=True),
    sa.Column('new_value', sa.Text(), nullable=True),
    sa.Column('timestamp', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('audit_id')
    )
    op.create_table('blackout_periods',
    sa.Column('blackout_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=False),
    sa.Column('leave_type_id', sa.BigInteger(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.PrimaryKeyConstraint('blackout_id')
    )
    op.create_table('calendar_feed_subscriptions',
    sa.Column('subscription_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('feed_token_hash', sa.String(length=128), nullable=False),
    sa.Column('scope', sa.String(length=20), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('revoked_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('subscription_id'),
    sa.UniqueConstraint('feed_token_hash')
    )
    op.create_table('delegations',
    sa.Column('delegation_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('nominator_id', sa.BigInteger(), nullable=False),
    sa.Column('delegate_id', sa.BigInteger(), nullable=False),
    sa.Column('set_by_id', sa.BigInteger(), nullable=False),
    sa.Column('from_date', sa.Date(), nullable=False),
    sa.Column('to_date', sa.Date(), nullable=False),
    sa.Column('revoked_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['delegate_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['nominator_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['set_by_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('delegation_id')
    )
    op.create_table('employee_final_settlements',
    sa.Column('settlement_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('deactivated_at', sa.DateTime(), nullable=False),
    sa.Column('settlement_snapshot_json', sa.Text(), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('settlement_id'),
    sa.UniqueConstraint('employee_id')
    )
    op.create_table('holidays',
    sa.Column('holiday_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('holiday_date', sa.Date(), nullable=False),
    sa.Column('holiday_name', sa.String(length=200), nullable=False),
    sa.Column('leave_year_id', sa.BigInteger(), nullable=False),
    sa.Column('region_id', sa.BigInteger(), nullable=True),
    sa.Column('is_optional', sa.Boolean(), nullable=False),
    sa.Column('created_by', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['leave_year_id'], ['leave_years.leave_year_id'], ),
    sa.ForeignKeyConstraint(['region_id'], ['regions.region_id'], ),
    sa.PrimaryKeyConstraint('holiday_id')
    )
    op.create_table('leave_accrual_configs',
    sa.Column('accrual_config_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('leave_type_id', sa.BigInteger(), nullable=False),
    sa.Column('accrual_method', sa.String(length=20), nullable=False),
    sa.Column('posting_day', sa.SmallInteger(), nullable=True),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.ForeignKeyConstraint(['updated_by'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('accrual_config_id'),
    sa.UniqueConstraint('leave_type_id')
    )
    op.create_table('leave_ledger',
    sa.Column('entry_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('leave_type_id', sa.BigInteger(), nullable=False),
    sa.Column('leave_year_id', sa.BigInteger(), nullable=False),
    sa.Column('entry_type', sa.String(length=40), nullable=False),
    sa.Column('quantity', sa.DECIMAL(precision=8, scale=1), nullable=False),
    sa.Column('source_reference', sa.String(length=100), nullable=False),
    sa.Column('actor_id', sa.BigInteger(), nullable=True),
    sa.Column('is_system_actor', sa.Boolean(), nullable=False),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.ForeignKeyConstraint(['leave_year_id'], ['leave_years.leave_year_id'], ),
    sa.PrimaryKeyConstraint('entry_id')
    )
    op.create_table('leave_policies',
    sa.Column('policy_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('leave_type_id', sa.BigInteger(), nullable=False),
    sa.Column('annual_entitlement', sa.DECIMAL(precision=6, scale=1), nullable=False),
    sa.Column('carries_forward', sa.Boolean(), nullable=False),
    sa.Column('carry_forward_cap', sa.DECIMAL(precision=6, scale=1), nullable=True),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.ForeignKeyConstraint(['updated_by'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('policy_id'),
    sa.UniqueConstraint('leave_type_id')
    )
    op.create_table('leave_requests',
    sa.Column('request_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('leave_type_id', sa.BigInteger(), nullable=False),
    sa.Column('leave_year_id', sa.BigInteger(), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=False),
    sa.Column('is_half_day', sa.Boolean(), nullable=False),
    sa.Column('half_day_portion', sa.String(length=10), nullable=True),
    sa.Column('reason', sa.Text(), nullable=False),
    sa.Column('state', sa.String(length=40), nullable=False),
    sa.Column('deducted_days', sa.DECIMAL(precision=6, scale=1), nullable=True),
    sa.Column('is_advance_leave', sa.Boolean(), nullable=False),
    sa.Column('is_long_leave', sa.Boolean(), nullable=False),
    sa.Column('application_timestamp', sa.DateTime(), nullable=True),
    sa.Column('withdrawal_window_end', sa.DateTime(), nullable=True),
    sa.Column('prior_leave_type_id', sa.BigInteger(), nullable=True),
    sa.Column('current_approver_id', sa.BigInteger(), nullable=True),
    sa.Column('sla_started_at', sa.DateTime(), nullable=True),
    sa.Column('lock_version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['current_approver_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.ForeignKeyConstraint(['leave_year_id'], ['leave_years.leave_year_id'], ),
    sa.ForeignKeyConstraint(['prior_leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.PrimaryKeyConstraint('request_id')
    )
    op.create_table('manager_reassignment_log',
    sa.Column('reassignment_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('old_manager_id', sa.BigInteger(), nullable=False),
    sa.Column('new_manager_id', sa.BigInteger(), nullable=False),
    sa.Column('pending_requests_transferred', sa.Boolean(), nullable=False),
    sa.Column('reassigned_by', sa.BigInteger(), nullable=False),
    sa.Column('reassigned_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['new_manager_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['old_manager_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['reassigned_by'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('reassignment_id')
    )
    op.create_table('notification_digest_preferences',
    sa.Column('preference_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('digest_enabled', sa.Boolean(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('preference_id'),
    sa.UniqueConstraint('employee_id')
    )
    op.create_table('notification_templates',
    sa.Column('template_key', sa.String(length=100), nullable=False),
    sa.Column('subject_template', sa.String(length=500), nullable=False),
    sa.Column('body_template', sa.Text(), nullable=False),
    sa.Column('tokens_json', sa.Text(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['updated_by'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('template_key')
    )
    op.create_table('organization_configs',
    sa.Column('config_key', sa.String(length=100), nullable=False),
    sa.Column('config_value', sa.Text(), nullable=False),
    sa.Column('value_type', sa.String(length=20), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=True),
    sa.Column('updated_by', sa.BigInteger(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['updated_by'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('config_key')
    )
    op.create_table('project_assignments',
    sa.Column('assignment_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('project_id', sa.BigInteger(), nullable=False),
    sa.Column('project_lead_id', sa.BigInteger(), nullable=False),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('effective_to', sa.Date(), nullable=True),
    sa.Column('created_by', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['project_id'], ['projects.project_id'], ),
    sa.ForeignKeyConstraint(['project_lead_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('assignment_id')
    )
    op.create_table('self_approval_permissions',
    sa.Column('self_approval_permission_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('granted_by', sa.BigInteger(), nullable=False),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('effective_to', sa.Date(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['granted_by'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('self_approval_permission_id')
    )
    op.create_index('ux_self_approval_one_active_per_employee', 'self_approval_permissions', ['employee_id'], unique=True, postgresql_where=sa.text('is_active'))
    op.create_table('standing_watchers',
    sa.Column('standing_watcher_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('watched_employee_id', sa.BigInteger(), nullable=False),
    sa.Column('watcher_employee_id', sa.BigInteger(), nullable=False),
    sa.Column('from_date', sa.Date(), nullable=False),
    sa.Column('to_date', sa.Date(), nullable=False),
    sa.Column('added_by_id', sa.BigInteger(), nullable=False),
    sa.Column('added_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['added_by_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['watched_employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['watcher_employee_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('standing_watcher_id')
    )
    op.create_table('team_capacity_limits',
    sa.Column('capacity_limit_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('manager_employee_id', sa.BigInteger(), nullable=False),
    sa.Column('max_concurrent_on_leave', sa.Integer(), nullable=False),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('effective_to', sa.Date(), nullable=True),
    sa.Column('created_by', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['manager_employee_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('capacity_limit_id')
    )
    op.create_table('user_roles',
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('role_id', sa.SmallInteger(), nullable=False),
    sa.Column('assigned_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['role_id'], ['roles.role_id'], ),
    sa.PrimaryKeyConstraint('employee_id', 'role_id')
    )
    op.create_table('working_pattern_assignments',
    sa.Column('assignment_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('working_pattern_id', sa.BigInteger(), nullable=False),
    sa.Column('effective_from', sa.Date(), nullable=False),
    sa.Column('effective_to', sa.Date(), nullable=True),
    sa.Column('assigned_by', sa.BigInteger(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['assigned_by'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['working_pattern_id'], ['working_patterns.working_pattern_id'], ),
    sa.PrimaryKeyConstraint('assignment_id')
    )
    op.create_table('compensatory_off_credits',
    sa.Column('comp_off_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('work_date', sa.Date(), nullable=False),
    sa.Column('hours_or_days', sa.DECIMAL(precision=6, scale=1), nullable=False),
    sa.Column('ledger_entry_id', sa.BigInteger(), nullable=True),
    sa.Column('approved_by', sa.BigInteger(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['approved_by'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['ledger_entry_id'], ['leave_ledger.entry_id'], ),
    sa.PrimaryKeyConstraint('comp_off_id')
    )
    op.create_table('leave_encashment_requests',
    sa.Column('encashment_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('leave_type_id', sa.BigInteger(), nullable=False),
    sa.Column('leave_year_id', sa.BigInteger(), nullable=False),
    sa.Column('days_encashed', sa.DECIMAL(precision=6, scale=1), nullable=False),
    sa.Column('ledger_entry_id', sa.BigInteger(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('requested_by', sa.BigInteger(), nullable=False),
    sa.Column('requested_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.ForeignKeyConstraint(['leave_year_id'], ['leave_years.leave_year_id'], ),
    sa.ForeignKeyConstraint(['ledger_entry_id'], ['leave_ledger.entry_id'], ),
    sa.ForeignKeyConstraint(['requested_by'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('encashment_id')
    )
    op.create_table('leave_request_approvals',
    sa.Column('approval_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('request_id', sa.BigInteger(), nullable=False),
    sa.Column('stage', sa.String(length=20), nullable=False),
    sa.Column('actor_id', sa.BigInteger(), nullable=False),
    sa.Column('on_behalf_of_id', sa.BigInteger(), nullable=True),
    sa.Column('decision', sa.String(length=10), nullable=False),
    sa.Column('reason', sa.Text(), nullable=True),
    sa.Column('decision_timestamp', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['on_behalf_of_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['request_id'], ['leave_requests.request_id'], ),
    sa.PrimaryKeyConstraint('approval_id')
    )
    op.create_table('leave_request_attachments',
    sa.Column('attachment_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('request_id', sa.BigInteger(), nullable=False),
    sa.Column('file_name', sa.String(length=255), nullable=False),
    sa.Column('content_type', sa.String(length=100), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('storage_path', sa.String(length=500), nullable=False),
    sa.Column('uploaded_by', sa.BigInteger(), nullable=False),
    sa.Column('uploaded_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['request_id'], ['leave_requests.request_id'], ),
    sa.ForeignKeyConstraint(['uploaded_by'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('attachment_id')
    )
    op.create_table('lop_records',
    sa.Column('lop_record_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('request_id', sa.BigInteger(), nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('prior_leave_type_id', sa.BigInteger(), nullable=False),
    sa.Column('lop_leave_type_id', sa.BigInteger(), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=False),
    sa.Column('end_date', sa.Date(), nullable=False),
    sa.Column('deducted_days', sa.DECIMAL(precision=6, scale=1), nullable=False),
    sa.Column('converted_at', sa.DateTime(), nullable=False),
    sa.Column('converted_by_job_run_id', sa.BigInteger(), nullable=True),
    sa.ForeignKeyConstraint(['converted_by_job_run_id'], ['scheduled_job_runs.job_run_id'], ),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['lop_leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.ForeignKeyConstraint(['prior_leave_type_id'], ['leave_types.leave_type_id'], ),
    sa.ForeignKeyConstraint(['request_id'], ['leave_requests.request_id'], ),
    sa.PrimaryKeyConstraint('lop_record_id'),
    sa.UniqueConstraint('request_id')
    )
    op.create_table('notifications',
    sa.Column('notification_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('recipient_id', sa.BigInteger(), nullable=False),
    sa.Column('channel', sa.String(length=10), nullable=False),
    sa.Column('template_key', sa.String(length=100), nullable=False),
    sa.Column('subject', sa.String(length=500), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('read_at', sa.DateTime(), nullable=True),
    sa.Column('related_request_id', sa.BigInteger(), nullable=True),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('sent_at', sa.DateTime(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['recipient_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['related_request_id'], ['leave_requests.request_id'], ),
    sa.PrimaryKeyConstraint('notification_id')
    )
    op.create_table('optional_holiday_selections',
    sa.Column('selection_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('employee_id', sa.BigInteger(), nullable=False),
    sa.Column('holiday_id', sa.BigInteger(), nullable=False),
    sa.Column('leave_year_id', sa.BigInteger(), nullable=False),
    sa.Column('selected_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['employee_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['holiday_id'], ['holidays.holiday_id'], ),
    sa.ForeignKeyConstraint(['leave_year_id'], ['leave_years.leave_year_id'], ),
    sa.PrimaryKeyConstraint('selection_id')
    )
    op.create_table('watchers',
    sa.Column('watcher_id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('request_id', sa.BigInteger(), nullable=False),
    sa.Column('watcher_employee_id', sa.BigInteger(), nullable=False),
    sa.Column('added_by_id', sa.BigInteger(), nullable=False),
    sa.Column('added_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['added_by_id'], ['users.user_id'], ),
    sa.ForeignKeyConstraint(['request_id'], ['leave_requests.request_id'], ),
    sa.ForeignKeyConstraint(['watcher_employee_id'], ['users.user_id'], ),
    sa.PrimaryKeyConstraint('watcher_id')
    )


def downgrade() -> None:
    op.drop_table('watchers')
    op.drop_table('optional_holiday_selections')
    op.drop_table('notifications')
    op.drop_table('lop_records')
    op.drop_table('leave_request_attachments')
    op.drop_table('leave_request_approvals')
    op.drop_table('leave_encashment_requests')
    op.drop_table('compensatory_off_credits')
    op.drop_table('working_pattern_assignments')
    op.drop_table('user_roles')
    op.drop_table('team_capacity_limits')
    op.drop_table('standing_watchers')
    op.drop_index('ux_self_approval_one_active_per_employee', table_name='self_approval_permissions', postgresql_where=sa.text('is_active'))
    op.drop_table('self_approval_permissions')
    op.drop_table('project_assignments')
    op.drop_table('organization_configs')
    op.drop_table('notification_templates')
    op.drop_table('notification_digest_preferences')
    op.drop_table('manager_reassignment_log')
    op.drop_table('leave_requests')
    op.drop_table('leave_policies')
    op.drop_table('leave_ledger')
    op.drop_table('leave_accrual_configs')
    op.drop_table('holidays')
    op.drop_table('employee_final_settlements')
    op.drop_table('delegations')
    op.drop_table('calendar_feed_subscriptions')
    op.drop_table('blackout_periods')
    op.drop_table('audit_log')
    op.drop_index('ux_users_employee_code_lower', table_name='users')
    op.drop_index('ux_users_email_lower', table_name='users')
    op.drop_table('users')
    op.drop_table('working_patterns')
    op.drop_table('scheduled_job_runs')
    op.drop_table('roles')
    op.drop_table('regions')
    op.drop_table('projects')
    op.drop_table('management_levels')
    op.drop_table('leave_years')
    op.drop_table('leave_types')
    op.drop_table('grades')
    op.drop_table('departments')
