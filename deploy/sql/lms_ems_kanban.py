"""Make azure-full-schema-lms-ems-kanban.sql from azure-full-schema.sql (run after refreshing that one).

    python deploy/sql/lms_ems_kanban.py

For the LMS-EMS-Kanban deployment (SUITE_SKIP=resume,ams): the same setup as azure-full-schema.sql
without the `resume` and `ams` schemas, and in plain SQL, so it runs from a query tool's Run button
(pgAdmin, Azure Data Studio, DBeaver) as well as with psql. The two passwords are set on the first
lines instead of with psql's -v. The suite tables' CHECK constraints keep 'ams' and 'resume', so either
app can be switched on later (it creates its own schema on its first start).
"""
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE / "azure-full-schema.sql"
TARGET = HERE / "azure-full-schema-lms-ems-kanban.sql"
DROPPED = ("resume", "ams")

text = SOURCE.read_text(encoding="utf-8").replace("\r\n", "\n")

HEADER_END = "-- ---- Part 1: roles"
head, rest = text.split(HEADER_END, 1)
rest = HEADER_END + rest

header = """-- =====================================================================================================
-- TT Suite (LMS, EMS and Kanban): full database schema for a NEW, EMPTY Azure Database for PostgreSQL
--
-- For the deployment without the Resume Evaluator and Asset Management (SUITE_SKIP=resume,ams).
-- Creates everything the suite needs before its first start:
--   * roles   app_owner (owns the schemas, runs migrations)  and  app_rw (what the apps use at runtime)
--   * schemas app (people, access, sessions), kanban, lms (Leave), expense (EMS) - no ams, no resume
--   * every table, index, constraint, sequence and grant, and each app's migration-version rows
-- No data: the apps add their reference data and the first global admin on first start, and apply any
-- newer migrations themselves.
--
-- HOW TO RUN (once, as the Azure server admin, connected to the new empty database, e.g. ttsuite):
--   1. Put the two passwords on the two SET lines below (12+ characters each; keep them for step 3).
--   2. Press Run in the query tool (pgAdmin, Azure Data Studio, DBeaver), or: psql "<admin connection>" -f <this file>
--      The last result lists the schemas app, expense, kanban, lms with their table counts.
--   3. App Service settings (URL-encode special characters in the passwords):
--        DATABASE_OWNER_URL = postgresql://app_owner:<owner password>@<server>.postgres.database.azure.com:5432/ttsuite?sslmode=require
--        DATABASE_URL       = postgresql://app_rw:<app password>@<server>.postgres.database.azure.com:5432/ttsuite?sslmode=require
--        SUITE_SKIP         = resume,ams
--   4. Put CHANGE-ME back on the two lines before you save or share this file.
-- Safe to retry: it refuses to run on a database that already has the suite schemas.
--
-- Generated from azure-full-schema.sql by deploy/sql/lms_ems_kanban.py; do not edit by hand.
-- =====================================================================================================

SET tt.owner_password = 'CHANGE-ME';
SET tt.app_password = 'CHANGE-ME';

"""

part1_psql = """-- ---- Part 1: roles (only created when missing; passwords come from -v, never from this file) ----------
SELECT format('CREATE ROLE app_owner LOGIN PASSWORD %L', :'owner_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') \\gexec
SELECT format('CREATE ROLE app_rw LOGIN PASSWORD %L', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') \\gexec
-- The admin acts as app_owner below (so app_owner owns every object, as when the apps migrate).
GRANT app_owner TO CURRENT_USER;
SELECT format('GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO app_owner', current_database()) \\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO app_rw', current_database()) \\gexec
"""
part1_plain = """-- ---- Part 1: roles (only created when missing; the passwords come from the two SET lines above) ------
DO $$
DECLARE owner_pw text := current_setting('tt.owner_password', true);
        app_pw   text := current_setting('tt.app_password', true);
BEGIN
  IF coalesce(owner_pw, 'CHANGE-ME') = 'CHANGE-ME' OR coalesce(app_pw, 'CHANGE-ME') = 'CHANGE-ME' THEN
    RAISE EXCEPTION 'Put the app_owner and app_rw passwords on the two SET lines at the top first. Nothing was created.';
  END IF;
  IF length(owner_pw) < 12 OR length(app_pw) < 12 THEN
    RAISE EXCEPTION 'Use passwords of at least 12 characters. Nothing was created.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    EXECUTE format('CREATE ROLE app_owner LOGIN PASSWORD %L', owner_pw);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    EXECUTE format('CREATE ROLE app_rw LOGIN PASSWORD %L', app_pw);
  END IF;
END
$$;
-- The admin acts as app_owner below (so app_owner owns every object, as when the apps migrate).
GRANT app_owner TO CURRENT_USER;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT, CREATE, TEMPORARY ON DATABASE %I TO app_owner', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_rw', current_database());
END
$$;
"""
assert part1_psql in rest, "Part 1 of azure-full-schema.sql changed: update this script"
rest = rest.replace(part1_psql, part1_plain)

# The schema lists in the run-twice guard and the final check.
all_schemas = "('app', 'kanban', 'lms', 'expense', 'ams', 'resume')"
assert rest.count(all_schemas) == 2, all_schemas
rest = rest.replace(all_schemas, "('app', 'kanban', 'lms', 'expense')")

# Only the pg_dump part is filtered; Part 3 (migration versions) and COMMIT after it stay.
DUMP_END = "-- PostgreSQL database dump complete\n"
assert rest.count(DUMP_END) == 1
dump, tail = rest.split(DUMP_END)
parts = re.split(r"(?=^--\n-- Name: )", dump, flags=re.M)
kept = []
for part in parts:
    title = part.split("\n", 2)[1] if part.startswith("--\n-- Name: ") else ""
    if any(f"; Schema: {s};" in title or title.startswith(f"-- Name: {s}; Type: SCHEMA;")
           or title.startswith(f"-- Name: SCHEMA {s}; Type: ACL;") for s in DROPPED):
        continue
    kept.append(part)
rest = "".join(kept) + DUMP_END + tail
assert "\nCOMMIT;\n" in tail
for s in DROPPED:
    rest = re.sub(rf"^INSERT INTO {s}\.alembic_version .*\n", "", rest, flags=re.M)

# psql-only lines: none may be left.
rest = re.sub(r"^\\(set ON_ERROR_STOP on|restrict \S+|unrestrict \S+)\n", "", rest, flags=re.M)
# Forget the passwords before the final check, so a query tool's last result is the table counts.
CHECK = "-- ---- Check ---"
assert rest.count(CHECK) == 1
rest = rest.replace(CHECK, "RESET tt.owner_password;\nRESET tt.app_password;\n\n" + CHECK)
out = header + rest

assert not re.search(r"^\\", out, flags=re.M), "a psql meta-command is left"
assert ":'" not in out, "a psql variable is left"
left = [line for line in out.splitlines() if re.search(r"\b(ams|resume)\.", line)
        or re.search(r"SCHEMA (ams|resume)\b", line)]
assert not left, f"still mentions schema ams/resume: {left[:3]}"
TARGET.write_text(out, encoding="utf-8", newline="\n")
print(f"{TARGET.name}: {len(parts) - len(kept)} ams/resume sections removed")
