#!/bin/sh
# Runs once, when the `db` container starts on an empty volume (postgres image entrypoint).
# The same two roles as on Azure: the owner runs migrations, the runtime role only reads and
# writes. Names and passwords come from deploy/docker.defaults.env and .env.docker. psql quotes
# them (:"name" identifiers, :'value' literals), so any password characters are safe.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db="$POSTGRES_DB" \
  -v owner="${DB_OWNER_USER:-app_owner}" -v owner_pw="$DB_OWNER_PASSWORD" \
  -v app="${DB_APP_USER:-app_rw}" -v app_pw="$DB_APP_PASSWORD" <<'EOSQL'
CREATE ROLE :"owner" LOGIN PASSWORD :'owner_pw';
CREATE ROLE :"app" LOGIN PASSWORD :'app_pw';
ALTER DATABASE :"db" OWNER TO :"owner";
ALTER SCHEMA public OWNER TO :"owner";
GRANT CONNECT ON DATABASE :"db" TO :"app";
EOSQL
