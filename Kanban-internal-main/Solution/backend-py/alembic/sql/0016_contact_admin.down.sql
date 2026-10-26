-- Contact-admin mails leave the outbox first so the old kind check holds.
DELETE FROM notification WHERE kind = 'contact_admin';
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'assigned', 'blocked', 'comment', 'closed', 'invited',
  'time_reminder', 'time_shortfall', 'time_shortfall_lead', 'time_team_report'));
