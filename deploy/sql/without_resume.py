"""Make azure-full-schema-without-resume.sql from azure-full-schema.sql (run after refreshing that one).

    python deploy/sql/without_resume.py

The full script is pg_dump output plus a header: every object sits in its own section that starts with
"-- Name: ...; Schema: <schema>; ...". This drops the `resume` schema, every section in it and its
migration-version row, for a deployment built with SUITE_SKIP=resume (no Resume Evaluator). The
suite tables' CHECK constraints keep the value 'resume', so it can be switched on later.
"""
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE / "azure-full-schema.sql"
TARGET = HERE / "azure-full-schema-without-resume.sql"

text = SOURCE.read_text(encoding="utf-8").replace("\r\n", "\n")

# Header lines that list the schemas.
replacements = [
    ("--   * schemas app (people, access, sessions), kanban, lms (Leave), expense (EMS), ams (Assets), resume\n",
     "--   * schemas app (people, access, sessions), kanban, lms (Leave), expense (EMS), ams (Assets)\n"
     "--   * WITHOUT the Resume Evaluator (no `resume` schema), for a suite built with SUITE_SKIP=resume\n"
     "--     Generated from azure-full-schema.sql by deploy/sql/without_resume.py; do not edit by hand.\n"),
    ("WHERE c.relkind = 'r' AND n.nspname IN ('app', 'kanban', 'lms', 'expense', 'ams', 'resume')",
     "WHERE c.relkind = 'r' AND n.nspname IN ('app', 'kanban', 'lms', 'expense', 'ams')"),
]
for old, new in replacements:
    assert old in text, old[:60]
    text = text.replace(old, new)

# Only the pg_dump part is filtered; the header (Part 1) and the versions and COMMIT after it stay.
DUMP_END = "-- PostgreSQL database dump complete\n"
assert text.count(DUMP_END) == 1
dump, tail = text.split(DUMP_END)

# pg_dump sections: split before each "--\n-- Name:" header, drop those in (or of) schema resume.
parts = re.split(r"(?=^--\n-- Name: )", dump, flags=re.M)
kept = []
for part in parts:
    head = part.split("\n", 2)[1] if part.startswith("--\n-- Name: ") else ""
    if "; Schema: resume;" in head or head.startswith("-- Name: resume; Type: SCHEMA;") \
            or head.startswith("-- Name: SCHEMA resume; Type: ACL;"):
        continue
    kept.append(part)
text = "".join(kept) + DUMP_END + tail
assert "\nCOMMIT;\n" in tail

# The migration-version row the header part inserts.
text = re.sub(r"^INSERT INTO resume\.alembic_version .*\n", "", text, flags=re.M)

left = [line for line in text.splitlines() if re.search(r"\bresume\.", line) or "SCHEMA resume" in line]
assert not left, f"still mentions schema resume: {left[:3]}"
TARGET.write_text(text, encoding="utf-8", newline="\n")
print(f"{TARGET.name}: {len(parts) - len(kept)} resume sections removed")
