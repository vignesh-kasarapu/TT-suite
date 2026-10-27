-- Basic profile details a person edits themselves on the dashboard (Profile). Name stays in
-- `name`; email is the Microsoft sign-in and only a global admin changes it.
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS job_title text NOT NULL DEFAULT '';
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS phone     text NOT NULL DEFAULT '';
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS location  text NOT NULL DEFAULT '';
