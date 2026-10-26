-- Renames UAT back to Testing, with a `state` event per card (as the upgrade writes).
ALTER TABLE card DROP CONSTRAINT card_state_check;

INSERT INTO card_event (id, card_id, group_id, field, old_value, new_value, actor_id, created_at)
SELECT upper(left(md5('uat2-back-event:' || id), 26)), id,
       upper(left(md5('uat2-back-group:' || id), 26)),
       'state', '"uat"'::jsonb, '"testing"'::jsonb, owner_id, now()
  FROM card
 WHERE state = 'uat';

UPDATE card SET state = 'testing', version = version + 1, updated_at = now() WHERE state = 'uat';

ALTER TABLE card ADD CONSTRAINT card_state_check
  CHECK (state IN ('backlog', 'in_prep', 'ready', 'in_development', 'testing', 'delivered', 'cancelled'));
