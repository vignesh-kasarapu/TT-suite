-- Starter identity: users, server-side sessions (ADR-005), per-user preferences.
-- ids are ULIDs (char(26), platform/ulid.ts). Session id = SHA-256 of the cookie value.
CREATE TABLE app_user (
  id          char(26)    PRIMARY KEY,
  email       text        NOT NULL,
  name        text        NOT NULL,
  role        text        NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  external_id text,                 -- Entra object id once SSO is on; null for dev/seeded users
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_user_email_idx ON app_user (lower(email));
CREATE UNIQUE INDEX app_user_external_idx ON app_user (external_id) WHERE external_id IS NOT NULL;

CREATE TABLE session (
  id          char(64)    PRIMARY KEY,   -- sha256 hex of the cookie value
  user_id     char(26)    NOT NULL REFERENCES app_user (id),
  created_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX session_user_idx ON session (user_id);

CREATE TABLE user_preference (
  user_id     char(26)    PRIMARY KEY REFERENCES app_user (id),
  theme       text        NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  accent      text        NOT NULL DEFAULT 'linen',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON app_user TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_preference TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON session TO app_rw;
