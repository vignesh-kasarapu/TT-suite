DROP INDEX project_open_idx;
ALTER TABLE project DROP COLUMN accepting, DROP COLUMN closed_at, DROP COLUMN closed_by;
