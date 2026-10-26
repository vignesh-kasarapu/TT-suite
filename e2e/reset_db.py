"""Recreate the e2e database: dropped and created empty, owned by the migrations role.

    python e2e/reset_db.py <admin_url> <database> <owner_role> <runtime_role>

The suite migrates every schema into it on start (app, kanban, lms, expense).
"""

import re
import sys

import psycopg

admin_url, database, owner, runtime = sys.argv[1:5]
for name in (database, owner, runtime):
    if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", name):
        sys.exit(f"refusing identifier {name!r}")
if not database.endswith("_e2e"):
    sys.exit(f"refusing to drop {database!r}: the e2e database name must end in _e2e")

with psycopg.connect(admin_url, autocommit=True) as conn:
    conn.execute(f"DROP DATABASE IF EXISTS {database} WITH (FORCE)")
    conn.execute(f"CREATE DATABASE {database} OWNER {owner}")
    conn.execute(f"GRANT CONNECT ON DATABASE {database} TO {runtime}")
print(f"e2e database {database} recreated")
