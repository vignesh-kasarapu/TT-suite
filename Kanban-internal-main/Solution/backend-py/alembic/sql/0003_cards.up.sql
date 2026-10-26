-- S1 cards: card, card_event (append-only), card_comment. See Outputs/Architecture/data-model.md.
CREATE OR REPLACE FUNCTION append_only_violation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_violation: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'raise_exception';
END
$$;

CREATE SEQUENCE card_number_seq;

CREATE TABLE card (
  id            char(26)     PRIMARY KEY,
  number        integer      NOT NULL UNIQUE DEFAULT nextval('card_number_seq'),
  title         text         NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description   text         NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  plane         text         NOT NULL CHECK (plane IN ('private', 'org')),
  state         text         NOT NULL DEFAULT 'backlog'
                             CHECK (state IN ('backlog', 'in_prep', 'ready', 'in_development', 'testing', 'uat', 'delivered', 'cancelled')),
  owner_id      char(26)     NOT NULL REFERENCES app_user (id),
  assignee_id   char(26)     REFERENCES app_user (id),
  priority      smallint     NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 4),
  tags          text[]       NOT NULL DEFAULT '{}',
  eta           date,
  effort_hours  numeric(7,2) CHECK (effort_hours >= 0),
  closed_at     timestamptz,
  version       integer      NOT NULL DEFAULT 1,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX card_owner_plane_state_idx ON card (owner_id, plane, state);
CREATE INDEX card_closed_idx ON card (closed_at) WHERE closed_at IS NOT NULL;

CREATE TABLE card_event (
  id          char(26)    PRIMARY KEY,
  card_id     char(26)    NOT NULL REFERENCES card (id),
  group_id    char(26)    NOT NULL,
  field       text        NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  actor_id    char(26)    NOT NULL REFERENCES app_user (id),
  created_at  timestamptz NOT NULL
);
CREATE INDEX card_event_card_idx ON card_event (card_id, created_at);
CREATE INDEX card_event_actor_idx ON card_event (actor_id, created_at);
CREATE TRIGGER card_event_append_only BEFORE UPDATE OR DELETE ON card_event
  FOR EACH ROW EXECUTE FUNCTION append_only_violation();

CREATE TABLE card_comment (
  id          char(26)    PRIMARY KEY,
  card_id     char(26)    NOT NULL REFERENCES card (id),
  author_id   char(26)    NOT NULL REFERENCES app_user (id),
  body        text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at  timestamptz NOT NULL,
  edited_at   timestamptz
);
CREATE INDEX card_comment_card_idx ON card_comment (card_id, created_at);

GRANT USAGE ON SEQUENCE card_number_seq TO app_rw;
GRANT SELECT, INSERT, UPDATE ON card TO app_rw;
GRANT SELECT, INSERT ON card_event TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON card_comment TO app_rw;
