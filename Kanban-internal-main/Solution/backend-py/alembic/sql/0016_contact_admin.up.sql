-- D-125: a person who cannot sign in can message the admins; the message goes out as email.
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'assigned', 'blocked', 'comment', 'closed', 'invited',
  'time_reminder', 'time_shortfall', 'time_shortfall_lead', 'time_team_report',
  'contact_admin'));
