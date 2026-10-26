-- CR-12: retiring a project in two steps. `accepting = false` stops intake (no card created in or
-- moved into the project) while the cards already there run to completion; `closed_at` retires it
-- and hides it from lists and pickers. Both are admin-only; closure refuses while open cards remain.
ALTER TABLE project
  ADD COLUMN accepting  boolean NOT NULL DEFAULT true,
  ADD COLUMN closed_at  timestamptz,
  ADD COLUMN closed_by  char(26) REFERENCES app_user (id);
-- Every project picker and filter reads the open set; closed projects are the rare tail.
CREATE INDEX project_open_idx ON project (team_id) WHERE closed_at IS NULL;
