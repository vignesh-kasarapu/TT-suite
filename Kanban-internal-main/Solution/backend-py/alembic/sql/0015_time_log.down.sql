-- Removes the time log tables; time-mail rows leave the outbox first so the old kind check holds.
DELETE FROM notification
  WHERE kind IN ('time_reminder', 'time_shortfall', 'time_shortfall_lead', 'time_team_report');
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check
  CHECK (kind IN ('assigned', 'blocked', 'comment', 'closed', 'invited'));
DROP INDEX time_entry_user_date_idx;
DROP TABLE time_mail_run;
DROP TABLE time_day_off;
DROP TABLE time_week_note;
