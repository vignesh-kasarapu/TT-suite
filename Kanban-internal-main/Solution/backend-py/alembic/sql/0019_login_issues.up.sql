-- D-144: messages from people who cannot sign in (D-125) are kept for Administration > Login
-- issues, newest first; an admin marks one resolved. The emails to admins go on as before.
CREATE TABLE login_issue (
  id           char(26)    PRIMARY KEY,
  name         text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email        text        NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  message      text        NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL,
  resolved_at  timestamptz,
  resolved_by  char(26)    REFERENCES app_user (id),
  CHECK ((resolved_at IS NULL) = (resolved_by IS NULL))
);
CREATE INDEX login_issue_created_idx ON login_issue (created_at DESC);

GRANT SELECT, INSERT, UPDATE ON login_issue TO app_rw;
