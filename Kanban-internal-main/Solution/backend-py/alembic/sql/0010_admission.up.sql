-- D-083: admission gate. Users are invited by an admin; sign-in requires an invited/active row.
ALTER TABLE app_user DROP CONSTRAINT app_user_status_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_status_check CHECK (status IN ('invited', 'active', 'inactive'));
ALTER TABLE app_user
  ADD COLUMN invited_at timestamptz,
  ADD COLUMN invited_by char(26) REFERENCES app_user (id);
ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN ('assigned', 'blocked', 'comment', 'closed', 'invited'));
