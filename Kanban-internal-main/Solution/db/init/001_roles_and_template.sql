-- Compose-only bootstrap (docker-entrypoint-initdb.d). Not a migration: creates the two
-- roles (owner runs migrations, rw is what the app connects as) and the per-test-file
-- template database. Runs once, at first `db` container start, as the `postgres` superuser.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    CREATE ROLE app_owner LOGIN PASSWORD 'dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw LOGIN PASSWORD 'dev';
  END IF;
END
$$;

ALTER DATABASE app OWNER TO app_owner;
GRANT CONNECT ON DATABASE app TO app_rw;
GRANT USAGE ON SCHEMA public TO app_rw;
-- Table-level grants are set by the migrations, once the tables exist.

-- Template DB for per-integration-test-file isolation: each test file runs
-- `CREATE DATABASE t_<file> TEMPLATE app_template`.
CREATE DATABASE app_template OWNER app_owner;
