-- 0020: the Testing state is renamed UAT (user 2026-10-22). Cards in Testing move to UAT, each
-- with a `state` event (FR-041) attributed to the card's owner - a migration has no actor of its
-- own, as in 0014. Old events keep the value they recorded. Ids are derived from the card id.
ALTER TABLE card DROP CONSTRAINT card_state_check;

INSERT INTO card_event (id, card_id, group_id, field, old_value, new_value, actor_id, created_at)
SELECT upper(left(md5('uat2-event:' || id), 26)), id, upper(left(md5('uat2-group:' || id), 26)),
       'state', '"testing"'::jsonb, '"uat"'::jsonb, owner_id, now()
  FROM card
 WHERE state = 'testing';

UPDATE card SET state = 'uat', version = version + 1, updated_at = now() WHERE state = 'testing';

ALTER TABLE card ADD CONSTRAINT card_state_check
  CHECK (state IN ('backlog', 'in_prep', 'ready', 'in_development', 'uat', 'delivered', 'cancelled'));
