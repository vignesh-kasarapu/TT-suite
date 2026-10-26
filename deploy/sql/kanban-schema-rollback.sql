-- ROLLBACK ONLY: move Kanban from schema `kanban` back to `public`, the layout the pre-suite
-- Kanban build (dist-azure) expects. Never needed for the suite itself: Kanban moves itself
-- into `kanban` on boot (Solution/backend-py/app/db/migrate.py, ensure_schema).
-- One transaction, as the owner role, with the suite stopped:
--
--   psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/sql/kanban-schema-rollback.sql
--
-- Tables take their rows, indexes, constraints, triggers and owned sequences with them; no data
-- is copied. Run the old build's migration downgrade (deploy/README.md, Rollback) as well.

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                          WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END AS kind,
           quote_ident(c.relname) AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'kanban' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    EXECUTE format('ALTER %s kanban.%s SET SCHEMA public', r.kind, r.name);
  END LOOP;

  FOR r IN
    SELECT quote_ident(c.relname) AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'kanban' AND c.relkind = 'S'
  LOOP
    EXECUTE format('ALTER SEQUENCE kanban.%s SET SCHEMA public', r.name);
  END LOOP;

  FOR r IN
    SELECT quote_ident(t.typname) AS name
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'kanban' AND t.typtype IN ('e', 'd', 'c')
       AND NOT EXISTS (SELECT 1 FROM pg_class cl WHERE cl.reltype = t.oid)
  LOOP
    EXECUTE format('ALTER TYPE kanban.%s SET SCHEMA public', r.name);
  END LOOP;

  FOR r IN
    SELECT quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'kanban' AND p.prokind IN ('f', 'p')
  LOOP
    EXECUTE format('ALTER ROUTINE kanban.%s SET SCHEMA public', r.name);
  END LOOP;
END
$$;

DROP SCHEMA kanban;  -- fails (and rolls everything back) if anything was left behind

-- Check: should be 0 and the number of Kanban tables.
SELECT (SELECT count(*) FROM pg_namespace WHERE nspname = 'kanban') AS kanban_schema_left,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS tables_in_public;

COMMIT;
