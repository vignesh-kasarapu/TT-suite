-- The rest of a person's own details, so the suite holds them once instead of every app
-- keeping its own copy. Job title, phone and location arrived in 0004; these are the fields
-- only LMS held until now. The person edits all of them in their suite profile; each app
-- copies what it needs on the person's next request.
--
-- Employment data is deliberately absent: department, grade, manager, region and roles stay
-- with the app that owns them, as do Expense's bank details.
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS date_of_birth           date;
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS personal_email          text NOT NULL DEFAULT '';
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS emergency_contact_name  text NOT NULL DEFAULT '';
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS emergency_contact_phone text NOT NULL DEFAULT '';
-- Free text rather than an enum: LMS matches it case-insensitively against a leave type's
-- gender_eligibility ('ALL' | 'FEMALE' | 'MALE'), and an unrecognised value simply never
-- restricts anything.
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS gender                  text NOT NULL DEFAULT '';
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS marital_status          text NOT NULL DEFAULT '';
