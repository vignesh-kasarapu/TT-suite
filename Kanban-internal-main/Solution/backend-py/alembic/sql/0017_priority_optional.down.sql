-- Cards without a priority go back to P3 so the old NOT NULL default holds.
UPDATE card SET priority = 3 WHERE priority IS NULL;
ALTER TABLE card ALTER COLUMN priority SET NOT NULL;
ALTER TABLE card ALTER COLUMN priority SET DEFAULT 3;
