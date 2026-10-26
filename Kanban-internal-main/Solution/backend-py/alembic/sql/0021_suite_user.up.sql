-- 0021: TT Suite single sign-on (SUITE-CONTRACT §3.3). Additive only: production data stays as
-- it is. `suite_user_id` links a Kanban person to `app.users.id`; it is filled in when the
-- person first arrives through the portal (or is provisioned or mirrored), so it starts empty.
ALTER TABLE app_user ADD COLUMN suite_user_id text;
ALTER TABLE app_user ADD CONSTRAINT app_user_suite_user_id_key UNIQUE (suite_user_id);
