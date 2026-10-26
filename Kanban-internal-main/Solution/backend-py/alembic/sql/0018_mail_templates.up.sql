-- D-141: admins edit the subject and text of each email; an email with no row here keeps the
-- built-in wording. One row per email kind.
CREATE TABLE mail_template (
  kind        text        PRIMARY KEY CHECK (kind IN (
                'invited', 'assigned', 'blocked', 'comment', 'closed',
                'time_reminder', 'time_shortfall', 'time_shortfall_lead', 'time_team_report',
                'contact_admin')),
  subject     text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 300),
  body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  updated_at  timestamptz NOT NULL,
  updated_by  char(26)    NOT NULL REFERENCES app_user (id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON mail_template TO app_rw;
