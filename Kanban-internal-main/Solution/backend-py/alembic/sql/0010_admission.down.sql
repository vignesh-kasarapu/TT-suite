DELETE FROM notification WHERE kind = 'invited';
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN ('assigned', 'blocked', 'comment', 'closed'));
UPDATE app_user SET status = 'inactive' WHERE status = 'invited';
ALTER TABLE app_user DROP COLUMN invited_by, DROP COLUMN invited_at;
ALTER TABLE app_user DROP CONSTRAINT app_user_status_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_status_check CHECK (status IN ('active', 'inactive'));
