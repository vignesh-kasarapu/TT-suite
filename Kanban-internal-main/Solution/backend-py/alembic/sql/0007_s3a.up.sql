-- S3a: inbox stamp (D-066), comment threads + votes (D-068), link attachments (D-069).
ALTER TABLE app_user ADD COLUMN inbox_seen_at timestamptz;
CREATE INDEX card_event_created_idx ON card_event (created_at);

ALTER TABLE card_comment ADD COLUMN parent_id char(26) REFERENCES card_comment (id);
CREATE INDEX card_comment_parent_idx ON card_comment (parent_id);

CREATE TABLE comment_vote (
  comment_id  char(26)    NOT NULL REFERENCES card_comment (id) ON DELETE CASCADE,
  user_id     char(26)    NOT NULL REFERENCES app_user (id),
  value       smallint    NOT NULL CHECK (value IN (-1, 1)),
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE attachment (
  id          char(26)    PRIMARY KEY,
  card_id     char(26)    REFERENCES card (id),
  project_id  char(26)    REFERENCES project (id),
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  url         text        NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048 AND url ~* '^https?://'),
  kind        text        CHECK (kind IN ('document', 'design', 'spec', 'other')),
  note        text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  added_by    char(26)    NOT NULL REFERENCES app_user (id),
  added_at    timestamptz NOT NULL,
  CHECK ((card_id IS NULL) <> (project_id IS NULL))
);
CREATE INDEX attachment_card_idx ON attachment (card_id);
CREATE INDEX attachment_project_idx ON attachment (project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON comment_vote TO app_rw;
GRANT SELECT, INSERT, DELETE ON attachment TO app_rw;
