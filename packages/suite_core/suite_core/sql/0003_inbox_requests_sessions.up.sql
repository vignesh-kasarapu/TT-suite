-- Sessions end after 24 hours without activity (30 days at most), several devices per person;
-- role changes are requested by app admins and decided by a global admin; one suite inbox.

-- When a session was last used, and on what (for "signed in on 2 devices"). expires_at slides
-- forward on use (suite_core.identity.resolve); created_at bounds it to the maximum lifetime.
ALTER TABLE app.session ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE app.session ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT '';

-- An app admin (or the person, for "Request access") asks for `role` in `app` for `user_id`;
-- role NULL = remove the access. Only a global admin decides; approving applies it through the
-- app's own /internal/provision, exactly like a change made in Users & access.
CREATE TABLE app.role_request (
    id             bigserial PRIMARY KEY,
    app            text NOT NULL CHECK (app IN ('kanban', 'lms', 'expense', 'ams')),
    user_id        text NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    role           text,
    lead_team_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
    note           text NOT NULL DEFAULT '',
    requested_by   text REFERENCES app.users (id) ON DELETE SET NULL,
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
    decided_by     text REFERENCES app.users (id) ON DELETE SET NULL,
    decision_note  text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    decided_at     timestamptz
);
-- At most one open request per person and app (a newer one replaces it).
CREATE UNIQUE INDEX role_request_one_pending ON app.role_request (app, user_id) WHERE status = 'pending';
CREATE INDEX role_request_status_idx ON app.role_request (status, created_at DESC);

-- The dashboard inbox: suite messages for one person.
CREATE TABLE app.message (
    id         bigserial PRIMARY KEY,
    user_id    text NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    kind       text NOT NULL,
    title      text NOT NULL,
    body       text NOT NULL DEFAULT '',
    link       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at    timestamptz
);
CREATE INDEX message_user_idx ON app.message (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.role_request, app.message TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_rw;
