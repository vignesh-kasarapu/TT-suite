-- The Asset Manager joins the suite as app `ams`: allow it in app.app_access.
-- The original CHECK was declared inline (auto-named), so it is found by what it checks.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'app.app_access'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kanban%'
  LOOP
    EXECUTE format('ALTER TABLE app.app_access DROP CONSTRAINT %I', c.conname);
  END LOOP;
END
$$;

ALTER TABLE app.app_access
  ADD CONSTRAINT app_access_app_check CHECK (app IN ('kanban', 'lms', 'expense', 'ams'));
