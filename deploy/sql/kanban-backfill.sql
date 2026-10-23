-- One-time Kanban cutover (WP8): bring the live Kanban people into the suite.
-- Run AFTER the first suite boot (schema `suite` and Kanban's suite_user_id migration exist),
-- as the owner role. Idempotent: running it twice changes nothing.
--
--   psql "$DATABASE_OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/sql/kanban-backfill.sql
--
-- Kanban's tables stay in `public`; nothing in them is changed except app_user.suite_user_id.
-- Kanban admins do NOT become global admins (SEED_GLOBAL_ADMIN_EMAIL decides that).

BEGIN;

-- 1. People. Kanban's ULIDs are reused as suite ids (same format), so the link is obvious.
--    Kanban 'active' people who have signed in before stay active; never-signed-in invites stay invited.
INSERT INTO suite.users (id, email, name, entra_oid, status, invited_at, created_at, updated_at)
SELECT u.id, lower(u.email), u.name, u.external_id,
       CASE u.status WHEN 'inactive' THEN 'inactive' WHEN 'invited' THEN 'invited' ELSE 'active' END,
       u.created_at, u.created_at, now()
  FROM public.app_user u
ON CONFLICT (email) DO NOTHING;

-- 2. Link each Kanban row to its suite person (by email).
UPDATE public.app_user u
   SET suite_user_id = s.id
  FROM suite.users s
 WHERE s.email = lower(u.email) AND u.suite_user_id IS DISTINCT FROM s.id;

-- 3. Kanban access = the effective role: admin > lead on any team > member; inactive = none.
INSERT INTO suite.app_access (user_id, app, role, source, updated_at)
SELECT u.suite_user_id, 'kanban',
       CASE WHEN u.role = 'admin' THEN 'admin'
            WHEN EXISTS (SELECT 1 FROM public.team_member m WHERE m.user_id = u.id AND m.is_lead) THEN 'lead'
            ELSE 'member' END,
       'app', now()
  FROM public.app_user u
 WHERE u.status <> 'inactive' AND u.suite_user_id IS NOT NULL
ON CONFLICT (user_id, app) DO UPDATE SET role = EXCLUDED.role, updated_at = now();

INSERT INTO suite.audit_log (action, detail)
VALUES ('kanban_backfill', jsonb_build_object('people', (SELECT count(*) FROM public.app_user)));

-- Check: these two numbers should match.
SELECT (SELECT count(*) FROM public.app_user) AS kanban_people,
       (SELECT count(*) FROM public.app_user WHERE suite_user_id IS NOT NULL) AS linked_to_suite;

COMMIT;
