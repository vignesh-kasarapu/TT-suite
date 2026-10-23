-- Same split as Azure: app_owner owns schemas and runs migrations; app_rw is the runtime role.
CREATE ROLE app_owner LOGIN PASSWORD 'dev';
CREATE ROLE app_rw LOGIN PASSWORD 'dev';
ALTER DATABASE ttsuite OWNER TO app_owner;
GRANT ALL ON SCHEMA public TO app_owner;
ALTER SCHEMA public OWNER TO app_owner;
GRANT CONNECT ON DATABASE ttsuite TO app_rw;
-- Test database used by the pytest suites (dropped/recreated freely).
CREATE DATABASE ttsuite_test OWNER app_owner;
