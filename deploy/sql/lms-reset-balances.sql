SET lms.confirm = 'no';

DO $$
DECLARE
  wanted text[] := ARRAY[
    'leave_request_attachments',
    'leave_request_approvals',
    'lop_records',
    'leave_requests',
    'leave_ledger',
    'compensatory_off_credits',
    'leave_encashment_requests',
    'leave_balance_restrictions',
    'employee_final_settlements',
    'watchers',
    'notifications'
  ];
  present text[];
  t text;
BEGIN
  IF current_setting('lms.confirm', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Set lms.confirm to yes on the line above to run this. Nothing was deleted.';
  END IF;

  FOREACH t IN ARRAY wanted LOOP
    IF to_regclass('lms.' || t) IS NOT NULL THEN
      present := present || ('lms.' || t);
    END IF;
  END LOOP;

  EXECUTE 'TRUNCATE TABLE ' || array_to_string(present, ', ') || ' RESTART IDENTITY';
  RAISE NOTICE 'emptied % table(s); % not present on this database',
               array_length(present, 1), array_length(wanted, 1) - COALESCE(array_length(present, 1), 0);
END $$;

SELECT 'leave_ledger' AS table, count(*) FROM lms.leave_ledger
UNION ALL SELECT 'notifications',      count(*) FROM lms.notifications
UNION ALL SELECT 'leave_requests',     count(*) FROM lms.leave_requests
UNION ALL SELECT 'comp_off_credits',   count(*) FROM lms.compensatory_off_credits
UNION ALL SELECT 'leave_types',        count(*) FROM lms.leave_types
UNION ALL SELECT 'leave_policies',     count(*) FROM lms.leave_policies
UNION ALL SELECT 'holidays',           count(*) FROM lms.holidays
UNION ALL SELECT 'users',              count(*) FROM lms.users
UNION ALL SELECT 'leave_years',        count(*) FROM lms.leave_years
ORDER BY 1;
