"""Move each person's details into the suite, once — a dry run by default.

Until now every app kept its own copy of a person's details and nobody reconciled them: LMS
is the only holder of dates of birth and emergency contacts, and employee codes have drifted
(a person can have one code in the portal and another in LMS). From 0008 the suite owns all
of it and the apps copy what they keep on the person's next request, so the suite's row has
to be the complete one first.

What it does: for every suite person, fill an EMPTY field in `app.users` from the richest
value an app holds. It never overwrites a value the portal already has — the portal is the
authority from here on, and a person who has edited their profile wins.

    python deploy/backfill_profiles.py                 # dry run: prints what it would fill
    python deploy/backfill_profiles.py --confirm       # writes it

Needs DATABASE_OWNER_URL (or DATABASE_URL) in the environment, the same way the apps do.
"""
import argparse
import os
import sys

import psycopg

# (portal column, LMS column). LMS is the only app holding the personal fields today;
# job title and phone also exist in Expense, which is handled below.
FROM_LMS = (
    ("job_title", "designation"),
    ("phone", "phone"),
    ("personal_email", "personal_email"),
    ("date_of_birth", "date_of_birth"),
    ("emergency_contact_name", "emergency_contact_name"),
    ("emergency_contact_phone", "emergency_contact_phone"),
    ("gender", "gender"),
    ("marital_status", "marital_status"),
    ("employee_code", "employee_code"),
)

# Expense fills only what LMS could not.
FROM_EXPENSE = (("job_title", "designation"), ("phone", "phone"), ("location", "location"))

#: The portal stores these two as fixed codes ("SINGLE"), while LMS held free text
#: ("Single"). Normalise on the way in so the portal's own dropdowns match what is there.
CODED = {"gender", "marital_status"}


def _url() -> str:
    url = os.environ.get("DATABASE_OWNER_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("Set DATABASE_OWNER_URL (or DATABASE_URL) first.")
    # psycopg wants a libpq URL; SQLAlchemy's "+psycopg" suffix is not one.
    return url.replace("postgresql+psycopg://", "postgresql://").replace("postgresql+asyncpg://", "postgresql://")


def _candidates(conn, schema: str, columns, link: str) -> dict[str, dict]:
    """{suite_user_id: {portal column: value}} of non-empty values held by one app."""
    selected = ", ".join(f"a.{app_col} AS {portal_col}" for portal_col, app_col in columns)
    rows = conn.execute(
        f"SELECT a.{link} AS suite_id, {selected} FROM {schema} a WHERE a.{link} IS NOT NULL"
    ).fetchall()
    names = [portal_col for portal_col, _ in columns]
    return {row[0]: {name: value for name, value in zip(names, row[1:]) if value not in (None, "")} for row in rows}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="write the values instead of printing them")
    args = parser.parse_args()

    with psycopg.connect(_url()) as conn:
        people = conn.execute(
            """
            SELECT id, email, job_title, phone, location, personal_email, date_of_birth,
                   emergency_contact_name, emergency_contact_phone, gender, marital_status, employee_code
              FROM app.users ORDER BY email
            """
        ).fetchall()
        portal_columns = [
            "job_title", "phone", "location", "personal_email", "date_of_birth",
            "emergency_contact_name", "emergency_contact_phone", "gender", "marital_status", "employee_code",
        ]
        from_lms = _candidates(conn, "lms.users", FROM_LMS, "suite_user_id")
        from_expense = _candidates(conn, "expense.users", FROM_EXPENSE, "suite_user_id")

        filled = 0
        for row in people:
            suite_id, email = row[0], row[1]
            current = dict(zip(portal_columns, row[2:]))
            available = {**from_expense.get(suite_id, {}), **from_lms.get(suite_id, {})}  # LMS wins
            changes = {
                column: (str(value).strip().upper().replace(" ", "_") if column in CODED else value)
                for column, value in available.items()
                if current.get(column) in (None, "") and value not in (None, "")
            }
            if not changes:
                continue
            filled += 1
            for column, value in changes.items():
                print(f"{email:<34}{column:<26}-> {value}")
            if args.confirm:
                assignments = ", ".join(f"{column} = %({column})s" for column in changes)
                conn.execute(
                    f"UPDATE app.users SET {assignments}, updated_at = now() WHERE id = %(id)s",
                    {**changes, "id": suite_id},
                )

        if not filled:
            print("Nothing to fill: every suite profile already holds what the apps do.")
            return
        if args.confirm:
            conn.commit()
            print(f"\nFilled {filled} suite profile(s). Each app copies them on the person's next request.")
        else:
            print(f"\nDry run: {filled} suite profile(s) would be filled. Re-run with --confirm to write them.")


if __name__ == "__main__":
    sys.exit(main())
