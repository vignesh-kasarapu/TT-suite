-- TT Suite identity schema (owned by the portal; read by every app).
-- `app_rw` is a placeholder swapped for the runtime role (see suite_core.migrate).

CREATE SCHEMA IF NOT EXISTS suite;

CREATE TABLE suite.users (
    id              text PRIMARY KEY,
    email           text NOT NULL UNIQUE CHECK (email = lower(email)),
    name            text NOT NULL DEFAULT '',
    entra_oid       text UNIQUE,
    status          text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'inactive')),
    is_global_admin boolean NOT NULL DEFAULT false,
    photo           bytea,
    photo_type      text,
    invited_by      text,
    invited_at      timestamptz,
    last_login_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per (person, app). Written ONLY by the owning app, in the same transaction as its own
-- user/role change (suite_core.identity.mirror_access) - the portal never writes it.
CREATE TABLE suite.app_access (
    user_id    text NOT NULL REFERENCES suite.users (id) ON DELETE CASCADE,
    app        text NOT NULL CHECK (app IN ('kanban', 'lms', 'expense')),
    role       text NOT NULL,
    source     text NOT NULL DEFAULT 'app' CHECK (source IN ('global', 'app')),
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, app)
);

-- The cookie carries random bytes; only their SHA-256 hex is stored.
CREATE TABLE suite.session (
    id         text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES suite.users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX session_user_idx ON suite.session (user_id);

CREATE TABLE suite.user_preference (
    user_id    text PRIMARY KEY REFERENCES suite.users (id) ON DELETE CASCADE,
    preset     text NOT NULL DEFAULT 'linen' CHECK (preset IN ('linen', 'harbour', 'graphite')),
    mode       text NOT NULL DEFAULT 'system' CHECK (mode IN ('system', 'light', 'dark')),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suite.audit_log (
    id        bigserial PRIMARY KEY,
    at        timestamptz NOT NULL DEFAULT now(),
    actor_id  text,
    action    text NOT NULL,
    target_id text,
    app       text,
    detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_at_idx ON suite.audit_log (at DESC);

CREATE TABLE suite.mail_outbox (
    id              bigserial PRIMARY KEY,
    to_email        text NOT NULL,
    kind            text NOT NULL,
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    attempts        int NOT NULL DEFAULT 0,
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz
);
CREATE INDEX mail_outbox_due_idx ON suite.mail_outbox (next_attempt_at) WHERE status = 'pending';

GRANT USAGE ON SCHEMA suite TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA suite TO app_rw;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA suite TO app_rw;
