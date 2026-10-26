-- Migration bookkeeping (read by backend/src/db/migrate.ts).
CREATE TABLE IF NOT EXISTS schema_migration (
  id          text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
