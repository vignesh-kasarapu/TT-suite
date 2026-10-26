-- Reverse of 0005_tags. card.tags keeps its values (free text again).
ALTER TABLE org_event DROP CONSTRAINT org_event_entity_type_check;
ALTER TABLE org_event ADD CONSTRAINT org_event_entity_type_check
  CHECK (entity_type IN ('team', 'program', 'project'));
DROP TABLE tag;
