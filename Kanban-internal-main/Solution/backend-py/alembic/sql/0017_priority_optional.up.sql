-- D-134: a card may have no priority (the new default). Existing cards keep theirs.
ALTER TABLE card ALTER COLUMN priority DROP DEFAULT;
ALTER TABLE card ALTER COLUMN priority DROP NOT NULL;
