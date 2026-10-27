-- The Resume Evaluator joins the suite as app `resume`: allow it wherever an app name is checked.
-- Both CHECKs were declared inline or by name; they are found by what they check.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
     WHERE conrelid IN ('app.app_access'::regclass, 'app.role_request'::regclass) AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kanban%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END
$$;

ALTER TABLE app.app_access
  ADD CONSTRAINT app_access_app_check CHECK (app IN ('kanban', 'lms', 'expense', 'ams', 'resume'));
ALTER TABLE app.role_request
  ADD CONSTRAINT role_request_app_check CHECK (app IN ('kanban', 'lms', 'expense', 'ams', 'resume'));
