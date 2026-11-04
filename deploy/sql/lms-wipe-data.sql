-- Empty the LMS of its leave data, keeping the people and the organisation around them.
--
-- WHAT GOES: every leave type, policy, pool, request, approval, attachment, ledger row,
-- comp-off claim, encashment, holiday, restriction, delegation, watcher, notification,
-- job run and audit entry in the `lms` schema.
--
-- WHAT STAYS: employees and their roles, departments, grades, regions, management levels,
-- projects, working patterns, leave years, organisation settings, notification templates
-- and the migration stamp — so the application still runs and people can still sign in.
-- The other schemas (app, kanban, expense, ams) are not touched at all.
--
-- THIS CANNOT BE UNDONE. The ledger and the audit log are append-only by design and this
-- throws both away; the backup you take first is the only way back.
--
-- Run a count first (writes nothing):
--
--   psql "$DATABASE_OWNER_URL" -f deploy/sql/lms-wipe-data.sql
--
-- Then, once the counts look right and the backup is verified:
--
--   psql "$DATABASE_OWNER_URL" -v confirm=yes -f deploy/sql/lms-wipe-data.sql
--
-- Afterwards the application has no leave types. An administrator creates them in
-- Administration > Leave types & policy, or a prepared policy is applied with
-- `python -m scripts.seed_company_policy --confirm`.

\set ON_ERROR_STOP on
\timing off

\echo ''
\echo '=== LMS data that would be deleted ==='

SELECT 'leave_requests'              AS table, count(*) FROM lms.leave_requests
UNION ALL SELECT 'leave_request_approvals',      count(*) FROM lms.leave_request_approvals
UNION ALL SELECT 'leave_request_attachments',    count(*) FROM lms.leave_request_attachments
UNION ALL SELECT 'lop_records',                  count(*) FROM lms.lop_records
UNION ALL SELECT 'leave_ledger',                 count(*) FROM lms.leave_ledger
UNION ALL SELECT 'compensatory_off_credits',     count(*) FROM lms.compensatory_off_credits
UNION ALL SELECT 'leave_encashment_requests',    count(*) FROM lms.leave_encashment_requests
UNION ALL SELECT 'leave_balance_restrictions',   count(*) FROM lms.leave_balance_restrictions
UNION ALL SELECT 'employee_final_settlements',   count(*) FROM lms.employee_final_settlements
UNION ALL SELECT 'holidays',                     count(*) FROM lms.holidays
UNION ALL SELECT 'optional_holiday_selections',  count(*) FROM lms.optional_holiday_selections
UNION ALL SELECT 'leave_types',                  count(*) FROM lms.leave_types
UNION ALL SELECT 'leave_policies',               count(*) FROM lms.leave_policies
UNION ALL SELECT 'leave_accrual_configs',        count(*) FROM lms.leave_accrual_configs
UNION ALL SELECT 'leave_entitlement_pools',      count(*) FROM lms.leave_entitlement_pools
UNION ALL SELECT 'leave_type_pool_members',      count(*) FROM lms.leave_type_pool_members
UNION ALL SELECT 'employee_leave_type_exclusions', count(*) FROM lms.employee_leave_type_exclusions
UNION ALL SELECT 'delegations',                  count(*) FROM lms.delegations
UNION ALL SELECT 'standing_watchers',            count(*) FROM lms.standing_watchers
UNION ALL SELECT 'watchers',                     count(*) FROM lms.watchers
UNION ALL SELECT 'self_approval_permissions',    count(*) FROM lms.self_approval_permissions
UNION ALL SELECT 'team_capacity_limits',         count(*) FROM lms.team_capacity_limits
UNION ALL SELECT 'blackout_periods',             count(*) FROM lms.blackout_periods
UNION ALL SELECT 'manager_reassignment_log',     count(*) FROM lms.manager_reassignment_log
UNION ALL SELECT 'notifications',                count(*) FROM lms.notifications
UNION ALL SELECT 'notification_digest_preferences', count(*) FROM lms.notification_digest_preferences
UNION ALL SELECT 'calendar_feed_subscriptions',  count(*) FROM lms.calendar_feed_subscriptions
UNION ALL SELECT 'scheduled_job_runs',           count(*) FROM lms.scheduled_job_runs
UNION ALL SELECT 'audit_log',                    count(*) FROM lms.audit_log
ORDER BY 2 DESC, 1;

\echo ''
\echo '=== kept (not touched) ==='

SELECT 'users' AS table, count(*) FROM lms.users
UNION ALL SELECT 'user_roles',             count(*) FROM lms.user_roles
UNION ALL SELECT 'roles',                  count(*) FROM lms.roles
UNION ALL SELECT 'departments',            count(*) FROM lms.departments
UNION ALL SELECT 'grades',                 count(*) FROM lms.grades
UNION ALL SELECT 'regions',                count(*) FROM lms.regions
UNION ALL SELECT 'management_levels',      count(*) FROM lms.management_levels
UNION ALL SELECT 'projects',               count(*) FROM lms.projects
UNION ALL SELECT 'project_assignments',    count(*) FROM lms.project_assignments
UNION ALL SELECT 'working_patterns',       count(*) FROM lms.working_patterns
UNION ALL SELECT 'working_pattern_assignments', count(*) FROM lms.working_pattern_assignments
UNION ALL SELECT 'leave_years',            count(*) FROM lms.leave_years
UNION ALL SELECT 'organization_configs',   count(*) FROM lms.organization_configs
UNION ALL SELECT 'notification_templates', count(*) FROM lms.notification_templates
ORDER BY 1;

\if :{?confirm}
\echo ''
\echo '>>> confirm set: deleting. One transaction — it all goes, or nothing does.'
\else
\echo ''
\echo 'Nothing was deleted (a count only).'
\echo 'To go ahead, after taking and verifying a backup:'
\echo '  psql "$DATABASE_OWNER_URL" -v confirm=yes -f deploy/sql/lms-wipe-data.sql'
\quit
\endif

BEGIN;

-- One statement: TRUNCATE handles the order among these tables itself, and no table outside
-- this list points into it (checked against pg_constraint). RESTART IDENTITY so the next
-- leave type created is id 1 again, like a database that has never been used.
TRUNCATE TABLE
  lms.leave_request_attachments,
  lms.leave_request_approvals,
  lms.lop_records,
  lms.leave_requests,
  lms.leave_ledger,
  lms.compensatory_off_credits,
  lms.leave_encashment_requests,
  lms.leave_balance_restrictions,
  lms.employee_final_settlements,
  lms.optional_holiday_selections,
  lms.holidays,
  lms.employee_leave_type_exclusions,
  lms.leave_type_pool_members,
  lms.leave_entitlement_pools,
  lms.leave_accrual_configs,
  lms.leave_policies,
  lms.leave_types,
  lms.delegations,
  lms.standing_watchers,
  lms.watchers,
  lms.self_approval_permissions,
  lms.team_capacity_limits,
  lms.blackout_periods,
  lms.manager_reassignment_log,
  lms.notifications,
  lms.notification_digest_preferences,
  lms.calendar_feed_subscriptions,
  lms.scheduled_job_runs,
  lms.audit_log
RESTART IDENTITY;

COMMIT;

\echo ''
\echo '=== after ==='

SELECT 'leave_types' AS table, count(*) FROM lms.leave_types
UNION ALL SELECT 'leave_requests', count(*) FROM lms.leave_requests
UNION ALL SELECT 'leave_ledger',   count(*) FROM lms.leave_ledger
UNION ALL SELECT 'holidays',       count(*) FROM lms.holidays
UNION ALL SELECT 'audit_log',      count(*) FROM lms.audit_log
UNION ALL SELECT 'users (kept)',   count(*) FROM lms.users
UNION ALL SELECT 'leave_years (kept)', count(*) FROM lms.leave_years
ORDER BY 1;

\echo ''
\echo 'Done. The application has no leave types now — create them in Administration >'
\echo 'Leave types & policy, or run: python -m scripts.seed_company_policy --confirm'
