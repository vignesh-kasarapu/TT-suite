-- S2 org plane: team, team_member, program, project, card_link, org_event; card.team_id/project_id;
-- copied_from_card_id on card_event/card_comment (D-056). See Outputs/Architecture/data-model.md (S2).
CREATE TABLE team (
  id          char(26)    PRIMARY KEY,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX team_name_idx ON team (lower(name));

CREATE TABLE team_member (
  team_id   char(26)    NOT NULL REFERENCES team (id),
  user_id   char(26)    NOT NULL REFERENCES app_user (id),
  added_at  timestamptz NOT NULL,
  added_by  char(26)    NOT NULL REFERENCES app_user (id),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_member_user_idx ON team_member (user_id);

CREATE TABLE program (
  id          char(26)    PRIMARY KEY,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  target_date date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX program_name_idx ON program (lower(name));

CREATE TABLE project (
  id          char(26)    PRIMARY KEY,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  team_id     char(26)    NOT NULL REFERENCES team (id),
  program_id  char(26)    REFERENCES program (id),
  target_date date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, team_id)                                  -- target of card's composite FK (FR-023)
);
CREATE UNIQUE INDEX project_team_name_idx ON project (team_id, lower(name));   -- D-045
CREATE INDEX project_program_idx ON project (program_id);

ALTER TABLE card
  ADD COLUMN team_id    char(26) REFERENCES team (id),
  ADD COLUMN project_id char(26),
  ADD CONSTRAINT card_private_has_no_team CHECK (plane = 'org' OR (team_id IS NULL AND project_id IS NULL)),
  -- A card's team is its project's team, by construction; re-teaming a project cascades (D-046).
  ADD CONSTRAINT card_project_team_fk FOREIGN KEY (project_id, team_id)
    REFERENCES project (id, team_id) ON UPDATE CASCADE;
CREATE INDEX card_team_state_idx ON card (team_id, state) WHERE plane = 'org';
CREATE INDEX card_project_idx ON card (project_id);
CREATE INDEX card_unassigned_idx ON card (state) WHERE plane = 'org' AND team_id IS NULL;

CREATE TABLE card_link (
  id            char(26)    PRIMARY KEY,
  from_card_id  char(26)    NOT NULL REFERENCES card (id),
  to_card_id    char(26)    NOT NULL REFERENCES card (id),
  type          text        NOT NULL CHECK (type IN ('relates_to', 'depends_on', 'blocks')),
  created_by    char(26)    NOT NULL REFERENCES app_user (id),
  created_at    timestamptz NOT NULL,
  CHECK (from_card_id <> to_card_id),
  UNIQUE (from_card_id, to_card_id, type)
);
CREATE INDEX card_link_from_idx ON card_link (from_card_id);
CREATE INDEX card_link_to_idx ON card_link (to_card_id);

CREATE TABLE org_event (
  id          char(26)    PRIMARY KEY,
  entity_type text        NOT NULL CHECK (entity_type IN ('team', 'program', 'project')),
  entity_id   char(26)    NOT NULL,
  group_id    char(26)    NOT NULL,
  field       text        NOT NULL,
  old_value   jsonb,
  new_value   jsonb,
  actor_id    char(26)    NOT NULL REFERENCES app_user (id),
  created_at  timestamptz NOT NULL
);
CREATE INDEX org_event_entity_idx ON org_event (entity_type, entity_id, created_at);
CREATE TRIGGER org_event_append_only BEFORE UPDATE OR DELETE ON org_event
  FOR EACH ROW EXECUTE FUNCTION append_only_violation();

ALTER TABLE card_event   ADD COLUMN copied_from_card_id char(26) REFERENCES card (id);
ALTER TABLE card_comment ADD COLUMN copied_from_card_id char(26) REFERENCES card (id);
CREATE INDEX card_event_copied_idx   ON card_event (copied_from_card_id)   WHERE copied_from_card_id IS NOT NULL;
CREATE INDEX card_comment_copied_idx ON card_comment (copied_from_card_id) WHERE copied_from_card_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON team TO app_rw;
GRANT SELECT, INSERT, DELETE ON team_member TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON program TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON project TO app_rw;
GRANT SELECT, INSERT, DELETE ON card_link TO app_rw;
GRANT SELECT, INSERT ON org_event TO app_rw;
