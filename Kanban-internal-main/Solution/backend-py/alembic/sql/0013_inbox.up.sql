-- CR-19: inbox housekeeping. Nothing is ever deleted - the card history is append-only (FR-041);
-- all three parts are filters or flags over the query `cards/inbox.ts` already runs.
-- 1. Retention becomes a per-person setting instead of the hard-coded WINDOW_DAYS = 30.
ALTER TABLE user_preference
  ADD COLUMN inbox_window_days integer NOT NULL DEFAULT 30
    CHECK (inbox_window_days BETWEEN 1 AND 365);
-- 2. "Clear everything up to this date" for one person: a second stamp beside inbox_seen_at.
ALTER TABLE app_user ADD COLUMN inbox_cleared_before timestamptz;
-- 3. Per-entry read state. inbox_seen_at stays as the "mark all seen" high-water mark; an entry
-- is unread when it is newer than that stamp AND has no row here. Rows age out with the window.
CREATE TABLE inbox_read (
  user_id   char(26)    NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  event_id  char(26)    NOT NULL REFERENCES card_event (id) ON DELETE CASCADE,
  read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);
GRANT SELECT, INSERT, DELETE ON inbox_read TO app_rw;
