SET lms.confirm = 'no';

DO $$
BEGIN
  IF current_setting('lms.confirm', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Set lms.confirm to yes on the line above to run this. Nothing was deleted.';
  END IF;
END $$;

BEGIN;

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

SELECT 'leave_types' AS table, count(*) FROM lms.leave_types
UNION ALL SELECT 'leave_requests', count(*) FROM lms.leave_requests
UNION ALL SELECT 'leave_ledger',   count(*) FROM lms.leave_ledger
UNION ALL SELECT 'holidays',       count(*) FROM lms.holidays
UNION ALL SELECT 'audit_log',      count(*) FROM lms.audit_log
UNION ALL SELECT 'users',          count(*) FROM lms.users
UNION ALL SELECT 'leave_years',    count(*) FROM lms.leave_years
ORDER BY 1;
