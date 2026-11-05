-- Merge an old standalone Kanban (a pg_dump at version 0016_contact_admin, loaded as schema
-- `kanban_old`) into the running TT Suite `kanban` schema. The suite's own Kanban work is kept.
--   * People are matched by email, teams / programs / tags by name, projects by team + name.
--   * Old cards keep their K-numbers; a suite card with a clashing number gets the next free one.
--   * Old 'testing' cards become 'uat' (Kanban migration 0020).
--   * No suite people are created: old people who are in the suite are linked and get Kanban
--     access (roles already set are kept); the others are listed and get linked when invited.
--
-- Plain SQL: open it in any query tool (pgAdmin, Azure Data Studio, DBeaver) connected to the
-- TT Suite database as the owner role and press Run, or `psql -f` it. The report is printed as
-- notices (the query tool's Messages tab). One transaction; refuses to run twice.
-- kanban-merge-dry-run.sql is this file with ROLLBACK as its last statement: keep the two the same.
SET client_min_messages = notice;  -- the report is printed as notices
BEGIN;

DO $$
BEGIN
  IF to_regnamespace('kanban_old') IS NULL THEN
    RAISE EXCEPTION 'Schema kanban_old not found: run kanban_old-load.sql first.';
  END IF;
  IF (SELECT version_num FROM kanban_old.alembic_version) <> '0016_contact_admin' THEN
    RAISE EXCEPTION 'kanban_old is at version %, expected 0016_contact_admin.',
      (SELECT version_num FROM kanban_old.alembic_version);
  END IF;
  IF EXISTS (SELECT 1 FROM app.audit_log WHERE action = 'kanban_merge') THEN
    RAISE EXCEPTION 'The old Kanban was already merged (app.audit_log: kanban_merge).';
  END IF;
END $$;

-- ---------------------------------------------------------------- people (matched by email)
CREATE TEMP TABLE map_user ON COMMIT DROP AS
SELECT o.id AS old_id,
       COALESCE(t.id, CASE WHEN EXISTS (SELECT 1 FROM kanban.app_user x WHERE x.id = o.id)
                           THEN upper(left(md5('kanban-merge:' || o.id), 26)) ELSE o.id END)::char(26) AS new_id,
       t.id IS NULL AS is_new
  FROM kanban_old.app_user o
  LEFT JOIN kanban.app_user t ON lower(t.email) = lower(o.email);

INSERT INTO kanban.app_user (id, email, name, role, status, external_id, created_at, updated_at, name_override,
                             photo, photo_type, photo_source, photo_updated_at, inbox_seen_at, invited_at,
                             invited_by, inbox_cleared_before, suite_user_id)
SELECT m.new_id, lower(o.email), o.name, o.role, o.status,
       CASE WHEN EXISTS (SELECT 1 FROM kanban.app_user x WHERE x.external_id = o.external_id)
            THEN NULL ELSE o.external_id END,
       o.created_at, o.updated_at, o.name_override, o.photo, o.photo_type, o.photo_source, o.photo_updated_at,
       o.inbox_seen_at, o.invited_at, NULL, o.inbox_cleared_before, NULL
  FROM kanban_old.app_user o
  JOIN map_user m ON m.old_id = o.id AND m.is_new;

-- invited_by points at another person: set once everyone is in
UPDATE kanban.app_user k SET invited_by = mi.new_id
  FROM kanban_old.app_user o
  JOIN map_user m ON m.old_id = o.id AND m.is_new
  JOIN map_user mi ON mi.old_id = o.invited_by
 WHERE k.id = m.new_id;

-- ---------------------------------------------------------------- teams, programs, tags (matched by name)
CREATE TEMP TABLE map_team ON COMMIT DROP AS
SELECT o.id AS old_id,
       COALESCE(t.id, CASE WHEN EXISTS (SELECT 1 FROM kanban.team x WHERE x.id = o.id)
                           THEN upper(left(md5('kanban-merge:' || o.id), 26)) ELSE o.id END)::char(26) AS new_id,
       t.id IS NULL AS is_new
  FROM kanban_old.team o LEFT JOIN kanban.team t ON lower(t.name) = lower(o.name);

-- The Teams webhook is not copied: it was encrypted with the old app's key.
INSERT INTO kanban.team (id, name, description, created_at, updated_at, teams_webhook_url_enc)
SELECT m.new_id, o.name, o.description, o.created_at, o.updated_at, NULL
  FROM kanban_old.team o JOIN map_team m ON m.old_id = o.id AND m.is_new;

INSERT INTO kanban.team_member (team_id, user_id, added_at, added_by, is_lead)
SELECT mt.new_id, mu.new_id, o.added_at, ma.new_id, o.is_lead
  FROM kanban_old.team_member o
  JOIN map_team mt ON mt.old_id = o.team_id
  JOIN map_user mu ON mu.old_id = o.user_id
  LEFT JOIN map_user ma ON ma.old_id = o.added_by
ON CONFLICT (team_id, user_id) DO NOTHING;

CREATE TEMP TABLE map_program ON COMMIT DROP AS
SELECT o.id AS old_id,
       COALESCE(t.id, CASE WHEN EXISTS (SELECT 1 FROM kanban.program x WHERE x.id = o.id)
                           THEN upper(left(md5('kanban-merge:' || o.id), 26)) ELSE o.id END)::char(26) AS new_id,
       t.id IS NULL AS is_new
  FROM kanban_old.program o LEFT JOIN kanban.program t ON lower(t.name) = lower(o.name);

INSERT INTO kanban.program (id, name, description, target_date, created_at, updated_at)
SELECT m.new_id, o.name, o.description, o.target_date, o.created_at, o.updated_at
  FROM kanban_old.program o JOIN map_program m ON m.old_id = o.id AND m.is_new;

CREATE TEMP TABLE map_tag ON COMMIT DROP AS
SELECT o.id AS old_id,
       COALESCE(t.id, CASE WHEN EXISTS (SELECT 1 FROM kanban.tag x WHERE x.id = o.id)
                           THEN upper(left(md5('kanban-merge:' || o.id), 26)) ELSE o.id END)::char(26) AS new_id,
       t.id IS NULL AS is_new
  FROM kanban_old.tag o LEFT JOIN kanban.tag t ON lower(t.name) = lower(o.name);

INSERT INTO kanban.tag (id, name, created_at)
SELECT m.new_id, o.name, o.created_at FROM kanban_old.tag o JOIN map_tag m ON m.old_id = o.id AND m.is_new;

-- ---------------------------------------------------------------- projects (matched by team + name)
CREATE TEMP TABLE map_project ON COMMIT DROP AS
SELECT o.id AS old_id,
       COALESCE(t.id, CASE WHEN EXISTS (SELECT 1 FROM kanban.project x WHERE x.id = o.id)
                           THEN upper(left(md5('kanban-merge:' || o.id), 26)) ELSE o.id END)::char(26) AS new_id,
       t.id IS NULL AS is_new
  FROM kanban_old.project o
  JOIN map_team mt ON mt.old_id = o.team_id
  LEFT JOIN kanban.project t ON t.team_id = mt.new_id AND lower(t.name) = lower(o.name);

INSERT INTO kanban.project (id, name, description, team_id, program_id, target_date, created_at, updated_at,
                            accepting, closed_at, closed_by)
SELECT m.new_id, o.name, o.description, mt.new_id, mp.new_id, o.target_date, o.created_at, o.updated_at,
       o.accepting, o.closed_at, mc.new_id
  FROM kanban_old.project o
  JOIN map_project m ON m.old_id = o.id AND m.is_new
  JOIN map_team mt ON mt.old_id = o.team_id
  LEFT JOIN map_program mp ON mp.old_id = o.program_id
  LEFT JOIN map_user mc ON mc.old_id = o.closed_by;

-- ---------------------------------------------------------------- cards: old cards keep their numbers
CREATE TEMP TABLE renumbered ON COMMIT DROP AS
SELECT c.id, c.number AS old_number,
       (GREATEST((SELECT COALESCE(max(number), 0) FROM kanban.card),
                 (SELECT COALESCE(max(number), 0) FROM kanban_old.card))
        + row_number() OVER (ORDER BY c.number))::int AS new_number
  FROM kanban.card c
 WHERE c.number IN (SELECT number FROM kanban_old.card);

UPDATE kanban.card c SET number = r.new_number, updated_at = now() FROM renumbered r WHERE c.id = r.id;

CREATE TEMP TABLE map_card ON COMMIT DROP AS
SELECT o.id AS old_id,
       (CASE WHEN EXISTS (SELECT 1 FROM kanban.card x WHERE x.id = o.id)
             THEN upper(left(md5('kanban-merge:' || o.id), 26)) ELSE o.id END)::char(26) AS new_id
  FROM kanban_old.card o;

INSERT INTO kanban.card (id, number, title, description, plane, state, owner_id, assignee_id, priority, tags, eta,
                         effort_hours, closed_at, version, created_at, updated_at, team_id, project_id)
SELECT m.new_id, o.number, o.title, o.description, o.plane,
       CASE o.state WHEN 'testing' THEN 'uat' ELSE o.state END,
       mo.new_id, ma.new_id, o.priority, o.tags, o.eta, o.effort_hours, o.closed_at, o.version,
       o.created_at, o.updated_at, mt.new_id, mp.new_id
  FROM kanban_old.card o
  JOIN map_card m ON m.old_id = o.id
  JOIN map_user mo ON mo.old_id = o.owner_id
  LEFT JOIN map_user ma ON ma.old_id = o.assignee_id
  LEFT JOIN map_team mt ON mt.old_id = o.team_id
  LEFT JOIN map_project mp ON mp.old_id = o.project_id;

-- ---------------------------------------------------------------- card history and the rest
INSERT INTO kanban.card_event (id, card_id, group_id, field, old_value, new_value, actor_id, created_at, copied_from_card_id)
SELECT o.id, mc.new_id, o.group_id, o.field, o.old_value, o.new_value, mu.new_id, o.created_at, mcf.new_id
  FROM kanban_old.card_event o
  JOIN map_card mc ON mc.old_id = o.card_id
  JOIN map_user mu ON mu.old_id = o.actor_id
  LEFT JOIN map_card mcf ON mcf.old_id = o.copied_from_card_id
 WHERE NOT EXISTS (SELECT 1 FROM kanban.card_event x WHERE x.id = o.id);

INSERT INTO kanban.card_comment (id, card_id, author_id, body, created_at, edited_at, copied_from_card_id, parent_id)
SELECT o.id, mc.new_id, mu.new_id, o.body, o.created_at, o.edited_at, mcf.new_id, o.parent_id
  FROM kanban_old.card_comment o
  JOIN map_card mc ON mc.old_id = o.card_id
  JOIN map_user mu ON mu.old_id = o.author_id
  LEFT JOIN map_card mcf ON mcf.old_id = o.copied_from_card_id
 WHERE NOT EXISTS (SELECT 1 FROM kanban.card_comment x WHERE x.id = o.id)
 ORDER BY o.created_at;  -- a reply comes after the comment it answers

INSERT INTO kanban.comment_vote (comment_id, user_id, value, created_at)
SELECT o.comment_id, mu.new_id, o.value, o.created_at
  FROM kanban_old.comment_vote o
  JOIN map_user mu ON mu.old_id = o.user_id
  JOIN kanban.card_comment c ON c.id = o.comment_id
ON CONFLICT DO NOTHING;

INSERT INTO kanban.card_link (id, from_card_id, to_card_id, type, created_by, created_at)
SELECT o.id, mf.new_id, mt.new_id, o.type, mu.new_id, o.created_at
  FROM kanban_old.card_link o
  JOIN map_card mf ON mf.old_id = o.from_card_id
  JOIN map_card mt ON mt.old_id = o.to_card_id
  JOIN map_user mu ON mu.old_id = o.created_by
ON CONFLICT DO NOTHING;

INSERT INTO kanban.attachment (id, card_id, project_id, title, url, kind, note, added_by, added_at)
SELECT o.id, mc.new_id, mp.new_id, o.title, o.url, o.kind, o.note, mu.new_id, o.added_at
  FROM kanban_old.attachment o
  LEFT JOIN map_card mc ON mc.old_id = o.card_id
  LEFT JOIN map_project mp ON mp.old_id = o.project_id
  JOIN map_user mu ON mu.old_id = o.added_by
 WHERE NOT EXISTS (SELECT 1 FROM kanban.attachment x WHERE x.id = o.id);

INSERT INTO kanban.time_entry (id, card_id, user_id, date, hours, note, created_at, updated_at)
SELECT o.id, mc.new_id, mu.new_id, o.date, o.hours, o.note, o.created_at, o.updated_at
  FROM kanban_old.time_entry o
  JOIN map_card mc ON mc.old_id = o.card_id
  JOIN map_user mu ON mu.old_id = o.user_id
 WHERE NOT EXISTS (SELECT 1 FROM kanban.time_entry x WHERE x.id = o.id);

INSERT INTO kanban.time_day_off (user_id, date, kind, created_at)
SELECT mu.new_id, o.date, o.kind, o.created_at
  FROM kanban_old.time_day_off o JOIN map_user mu ON mu.old_id = o.user_id
ON CONFLICT DO NOTHING;

INSERT INTO kanban.time_week_note (user_id, week_start, note, updated_at)
SELECT mu.new_id, o.week_start, o.note, o.updated_at
  FROM kanban_old.time_week_note o JOIN map_user mu ON mu.old_id = o.user_id
ON CONFLICT DO NOTHING;

INSERT INTO kanban.time_mail_run (job, week_start, ran_at)
SELECT o.job, o.week_start, o.ran_at FROM kanban_old.time_mail_run o
ON CONFLICT DO NOTHING;

INSERT INTO kanban.user_preference (user_id, theme, accent, updated_at, notify_email, primary_team_id,
                                    primary_project_id, org_order, inbox_window_days)
SELECT mu.new_id, o.theme, o.accent, o.updated_at, o.notify_email, mt.new_id, mp.new_id, o.org_order, o.inbox_window_days
  FROM kanban_old.user_preference o
  JOIN map_user mu ON mu.old_id = o.user_id
  LEFT JOIN map_team mt ON mt.old_id = o.primary_team_id
  LEFT JOIN map_project mp ON mp.old_id = o.primary_project_id
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO kanban.inbox_read (user_id, event_id, read_at)
SELECT mu.new_id, o.event_id, o.read_at
  FROM kanban_old.inbox_read o
  JOIN map_user mu ON mu.old_id = o.user_id
  JOIN kanban.card_event e ON e.id = o.event_id
ON CONFLICT DO NOTHING;

INSERT INTO kanban.org_event (id, entity_type, entity_id, group_id, field, old_value, new_value, actor_id, created_at)
SELECT o.id, o.entity_type,
       COALESCE(CASE o.entity_type
                  WHEN 'team'    THEN (SELECT new_id FROM map_team    WHERE old_id = o.entity_id)
                  WHEN 'program' THEN (SELECT new_id FROM map_program WHERE old_id = o.entity_id)
                  WHEN 'project' THEN (SELECT new_id FROM map_project WHERE old_id = o.entity_id)
                  WHEN 'tag'     THEN (SELECT new_id FROM map_tag     WHERE old_id = o.entity_id)
                  WHEN 'user'    THEN (SELECT new_id FROM map_user    WHERE old_id = o.entity_id)
                END, o.entity_id),
       o.group_id, o.field, o.old_value, o.new_value, mu.new_id, o.created_at
  FROM kanban_old.org_event o
  JOIN map_user mu ON mu.old_id = o.actor_id
 WHERE NOT EXISTS (SELECT 1 FROM kanban.org_event x WHERE x.id = o.id);

-- Not copied on purpose: session (the suite signs people in), notification / mail_stub_message
-- (the old outbox, already sent), schema_migration / alembic_version.

SELECT setval('kanban.card_number_seq', (SELECT max(number) FROM kanban.card));

-- ---------------------------------------------------------------- link to suite people (never creates any)
UPDATE kanban.app_user k
   SET suite_user_id = s.id
  FROM app.users s
 WHERE lower(s.email) = lower(k.email)
   AND k.suite_user_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM kanban.app_user x WHERE x.suite_user_id = s.id);

-- Suite people with no Kanban access yet get their old role; roles already set are kept.
INSERT INTO app.app_access (user_id, app, role, source, updated_at)
SELECT k.suite_user_id, 'kanban',
       CASE WHEN k.role = 'admin' THEN 'admin'
            WHEN EXISTS (SELECT 1 FROM kanban.team_member tm WHERE tm.user_id = k.id AND tm.is_lead) THEN 'lead'
            ELSE 'member' END,
       'app', now()
  FROM kanban.app_user k
  JOIN map_user mu ON mu.new_id = k.id
 WHERE k.suite_user_id IS NOT NULL AND k.status <> 'inactive'
ON CONFLICT (user_id, app) DO NOTHING;

INSERT INTO app.audit_log (action, app, detail)
VALUES ('kanban_merge', 'kanban', jsonb_build_object(
  'cards', (SELECT count(*) FROM kanban_old.card),
  'people', (SELECT count(*) FROM kanban_old.app_user),
  'renumbered_suite_cards', (SELECT count(*) FROM renumbered)));

-- ---------------------------------------------------------------- report (notices: the Messages tab)
DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE '== Old Kanban rows vs what is now in the suite (old / matched existing / added)';
  FOR r IN
    SELECT 'people' AS what, (SELECT count(*) FROM kanban_old.app_user) AS old,
           (SELECT count(*) FROM map_user WHERE NOT is_new) AS matched, (SELECT count(*) FROM map_user WHERE is_new) AS added
    UNION ALL SELECT 'teams', (SELECT count(*) FROM kanban_old.team),
           (SELECT count(*) FROM map_team WHERE NOT is_new), (SELECT count(*) FROM map_team WHERE is_new)
    UNION ALL SELECT 'programs', (SELECT count(*) FROM kanban_old.program),
           (SELECT count(*) FROM map_program WHERE NOT is_new), (SELECT count(*) FROM map_program WHERE is_new)
    UNION ALL SELECT 'projects', (SELECT count(*) FROM kanban_old.project),
           (SELECT count(*) FROM map_project WHERE NOT is_new), (SELECT count(*) FROM map_project WHERE is_new)
    UNION ALL SELECT 'cards', (SELECT count(*) FROM kanban_old.card), 0,
           (SELECT count(*) FROM kanban.card k JOIN map_card m ON m.new_id = k.id)
    UNION ALL SELECT 'card events', (SELECT count(*) FROM kanban_old.card_event), 0,
           (SELECT count(*) FROM kanban.card_event e JOIN kanban_old.card_event o ON o.id = e.id)
    UNION ALL SELECT 'comments', (SELECT count(*) FROM kanban_old.card_comment), 0,
           (SELECT count(*) FROM kanban.card_comment c JOIN kanban_old.card_comment o ON o.id = c.id)
    UNION ALL SELECT 'card links', (SELECT count(*) FROM kanban_old.card_link), 0,
           (SELECT count(*) FROM kanban.card_link c JOIN kanban_old.card_link o ON o.id = c.id)
    UNION ALL SELECT 'attachments', (SELECT count(*) FROM kanban_old.attachment), 0,
           (SELECT count(*) FROM kanban.attachment a JOIN kanban_old.attachment o ON o.id = a.id)
    UNION ALL SELECT 'time entries', (SELECT count(*) FROM kanban_old.time_entry), 0,
           (SELECT count(*) FROM kanban.time_entry t JOIN kanban_old.time_entry o ON o.id = t.id)
  LOOP
    RAISE NOTICE '  %: old %, matched existing %, added %', rpad(r.what, 12), r.old, r.matched, r.added;
  END LOOP;

  RAISE NOTICE '== Suite cards that got a new number (old cards keep theirs)';
  FOR r IN SELECT old_number, new_number FROM renumbered ORDER BY old_number LOOP
    RAISE NOTICE '  K-% is now K-%', r.old_number, r.new_number;
  END LOOP;
  RAISE NOTICE '  next new card: K-%', (SELECT max(number) + 1 FROM kanban.card);

  RAISE NOTICE '== Old Kanban people not in the TT Suite yet (invite them if they should have access)';
  FOR r IN SELECT k.email, k.name, k.status FROM kanban.app_user k JOIN map_user mu ON mu.new_id = k.id
            WHERE k.suite_user_id IS NULL ORDER BY k.email LOOP
    RAISE NOTICE '  % (%), %', r.email, r.name, r.status;
  END LOOP;
END $$;

COMMIT;
