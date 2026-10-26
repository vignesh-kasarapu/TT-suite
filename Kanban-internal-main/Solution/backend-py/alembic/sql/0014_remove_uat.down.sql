-- Allows UAT again; cards moved to Testing by 0014 stay in Testing (their events record the move).
ALTER TABLE card DROP CONSTRAINT card_state_check;
ALTER TABLE card ADD CONSTRAINT card_state_check
  CHECK (state IN ('backlog', 'in_prep', 'ready', 'in_development', 'testing', 'uat', 'delivered', 'cancelled'));
