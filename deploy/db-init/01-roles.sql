-- Same split as Azure: app_owner owns schemas and runs migrations; app_rw is the runtime role.
CREATE ROLE app_owner LOGIN PASSWORD 'dev';
CREATE ROLE app_rw LOGIN PASSWORD 'dev';
ALTER DATABASE ttsuite OWNER TO app_owner;
GRANT ALL ON SCHEMA public TO app_owner;
ALTER SCHEMA public OWNER TO app_owner;
GRANT CONNECT ON DATABASE ttsuite TO app_rw;
-- Test database used by the pytest suites (dropped/recreated freely).
CREATE DATABASE ttsuite_test OWNER app_owner;
-- The LMS and EMS test suites' own databases (their conftests use them; app_owner cannot create databases).
CREATE DATABASE lms_test OWNER app_owner;
GRANT CONNECT ON DATABASE lms_test TO app_rw;
CREATE DATABASE ems_test OWNER app_owner;
GRANT CONNECT ON DATABASE ems_test TO app_rw;
