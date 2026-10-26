-- 0014: UAT is no longer a card state (D-112, user 2026-10-07). Cards in UAT move to Testing, each
-- with a `state` event (FR-041) attributed to the card's owner - a migration has no actor of its
-- own - then the state rule narrows. Ids are derived from the card id, as 0005's backfill does.
INSERT INTO card_event (id, card_id, group_id, field, old_value, new_value, actor_id, created_at)
SELECT upper(left(md5('uat-event:' || id), 26)), id, upper(left(md5('uat-group:' || id), 26)),
       'state', '"uat"'::jsonb, '"testing"'::jsonb, owner_id, now()
  FROM card
 WHERE state = 'uat';

UPDATE card SET state = 'testing', version = version + 1, updated_at = now() WHERE state = 'uat';

ALTER TABLE card DROP CONSTRAINT card_state_check;
ALTER TABLE card ADD CONSTRAINT card_state_check
  CHECK (state IN ('backlog', 'in_prep', 'ready', 'in_development', 'testing', 'delivered', 'cancelled'));
