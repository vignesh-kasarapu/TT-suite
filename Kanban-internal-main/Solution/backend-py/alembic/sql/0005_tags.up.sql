-- Admin-managed tag vocabulary (D-062, amends D-019). card.tags stays text[] of tag names; the
-- backend accepts only names present here. Backfilled from the tags already on cards.
CREATE TABLE tag (
  id          char(26)    PRIMARY KEY,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tag_name_idx ON tag (lower(name));

-- Deterministic Crockford-safe id from the lower-cased name (hex digits only), one per distinct name.
INSERT INTO tag (id, name)
SELECT DISTINCT ON (lower(t)) upper(left(md5('tag:' || lower(t)), 26)), t
FROM card, unnest(tags) AS t
ORDER BY lower(t), t;

ALTER TABLE org_event DROP CONSTRAINT org_event_entity_type_check;
ALTER TABLE org_event ADD CONSTRAINT org_event_entity_type_check
  CHECK (entity_type IN ('team', 'program', 'project', 'tag'));

GRANT SELECT, INSERT, UPDATE, DELETE ON tag TO app_rw;
