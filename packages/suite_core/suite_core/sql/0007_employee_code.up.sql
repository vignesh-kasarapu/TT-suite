-- The company employee code, one per person, given by the global admin when inviting.
-- Unique ignoring case; NULL only for people added before codes existed (the admin fills it in).
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS employee_code text;
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_code_key ON app.users (lower(employee_code)) WHERE employee_code IS NOT NULL;
