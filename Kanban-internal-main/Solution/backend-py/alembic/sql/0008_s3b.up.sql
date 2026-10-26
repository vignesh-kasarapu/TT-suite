-- S3b: time entries (D-071), notification outbox + stub mail (D-073/D-074), email opt-in, Teams webhook (D-075).
CREATE TABLE time_entry (
  id          char(26)     PRIMARY KEY,
  card_id     char(26)     NOT NULL REFERENCES card (id),
  user_id     char(26)     NOT NULL REFERENCES app_user (id),
  date        date         NOT NULL,
  hours       numeric(6,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  note        text         NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  created_at  timestamptz  NOT NULL,
  updated_at  timestamptz  NOT NULL
);
CREATE INDEX time_entry_card_idx ON time_entry (card_id, date);

CREATE TABLE notification (
  id          char(26)    PRIMARY KEY,
  channel     text        NOT NULL CHECK (channel IN ('email', 'teams')),
  target_id   char(26)    NOT NULL,
  kind        text        NOT NULL CHECK (kind IN ('assigned', 'blocked', 'comment', 'closed')),
  payload     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL,
  sent_at     timestamptz,
  attempts    smallint    NOT NULL DEFAULT 0,
  last_error  text
);
CREATE INDEX notification_pending_idx ON notification (created_at) WHERE sent_at IS NULL;

CREATE TABLE mail_stub_message (
  id          char(26)    PRIMARY KEY,
  to_email    text        NOT NULL,
  subject     text        NOT NULL,
  body        text        NOT NULL,
  created_at  timestamptz NOT NULL
);

ALTER TABLE user_preference ADD COLUMN notify_email boolean NOT NULL DEFAULT false;
ALTER TABLE team ADD COLUMN teams_webhook_url_enc bytea;

GRANT SELECT, INSERT, UPDATE, DELETE ON time_entry TO app_rw;
GRANT SELECT, INSERT, UPDATE ON notification TO app_rw;
GRANT SELECT, INSERT, DELETE ON mail_stub_message TO app_rw;
