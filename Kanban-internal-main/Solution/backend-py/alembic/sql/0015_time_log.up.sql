-- D-116 time log: a week note and leave/holiday days per person, a once-per-week record of the
-- Friday and Monday mail runs, and the four time-mail kinds in the outbox.
CREATE TABLE time_week_note (
  user_id     char(26)    NOT NULL REFERENCES app_user (id),
  week_start  date        NOT NULL CHECK (extract(isodow FROM week_start) = 1),
  note        text        NOT NULL CHECK (char_length(note) <= 2000),
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, week_start)
);

CREATE TABLE time_day_off (
  user_id     char(26)    NOT NULL REFERENCES app_user (id),
  date        date        NOT NULL CHECK (extract(isodow FROM date) BETWEEN 1 AND 5),
  kind        text        NOT NULL CHECK (kind IN ('leave', 'holiday')),
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE time_mail_run (
  job         text        NOT NULL CHECK (job IN ('friday_reminder', 'monday_review')),
  week_start  date        NOT NULL,
  ran_at      timestamptz NOT NULL,
  PRIMARY KEY (job, week_start)
);

CREATE INDEX time_entry_user_date_idx ON time_entry (user_id, date);

ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (
  'assigned', 'blocked', 'comment', 'closed', 'invited',
  'time_reminder', 'time_shortfall', 'time_shortfall_lead', 'time_team_report'));

GRANT SELECT, INSERT, UPDATE, DELETE ON time_week_note TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON time_day_off TO app_rw;
GRANT SELECT, INSERT ON time_mail_run TO app_rw;
