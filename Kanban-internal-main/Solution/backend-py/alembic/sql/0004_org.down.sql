-- Reverse of 0004_org. Data in the S2 tables is lost; card rows keep everything from 0003.
DROP INDEX IF EXISTS card_comment_copied_idx;
DROP INDEX IF EXISTS card_event_copied_idx;
ALTER TABLE card_comment DROP COLUMN copied_from_card_id;
ALTER TABLE card_event   DROP COLUMN copied_from_card_id;
DROP TABLE org_event;
DROP TABLE card_link;
DROP INDEX IF EXISTS card_unassigned_idx;
DROP INDEX IF EXISTS card_project_idx;
DROP INDEX IF EXISTS card_team_state_idx;
ALTER TABLE card
  DROP CONSTRAINT card_project_team_fk,
  DROP CONSTRAINT card_private_has_no_team,
  DROP COLUMN project_id,
  DROP COLUMN team_id;
DROP TABLE project;
DROP TABLE program;
DROP TABLE team_member;
DROP TABLE team;
