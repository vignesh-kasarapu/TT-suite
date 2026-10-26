-- CR-11: team lead. A per-team flag set by an admin; a lead manages that team's membership,
-- projects and Teams webhook, and nothing outside their own teams.
ALTER TABLE team_member ADD COLUMN is_lead boolean NOT NULL DEFAULT false;
-- team_member only ever gained rows before; the lead flag is the first UPDATE on it.
GRANT UPDATE ON team_member TO app_rw;
