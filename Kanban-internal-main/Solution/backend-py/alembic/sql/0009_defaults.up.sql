-- D-077: personal defaults for the Org tab.
ALTER TABLE user_preference
  ADD COLUMN primary_team_id    char(26) REFERENCES team (id) ON DELETE SET NULL,
  ADD COLUMN primary_project_id char(26) REFERENCES project (id) ON DELETE SET NULL,
  ADD COLUMN org_order          text NOT NULL DEFAULT 'team_first' CHECK (org_order IN ('team_first', 'project_first'));
