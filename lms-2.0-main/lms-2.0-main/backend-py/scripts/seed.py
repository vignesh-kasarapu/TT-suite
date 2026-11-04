"""Reference-data seed, run once per fresh database: 3 roles, 5 management levels, the
current leave year, config defaults, notification templates and the "Unassigned" department
that TT Suite provisioning puts new people in.

**No leave type is created here**, not even Loss of Pay or Compensatory Off. Leave types are
company policy, and a deployment must never decide a company's policy for it: a fresh
database comes up with an empty Leave types screen that an authorised admin fills in. A
prepared policy file is loaded deliberately with `python -m scripts.seed_company_policy
--confirm`, never from a boot path. No employees are created here either (see
scripts/seed_demo.py for a populated demo org, which refuses to run under APP_PROFILE=prod).

The values live in seed/reference.json (app.core.seed_data), not in this file; the logic
below is find-or-create, so re-running never duplicates or overwrites anything.

TT Suite: also mirrors every existing employee's effective LMS role into
app.app_access (idempotent backfill), so the portal's access matrix matches. Runs
automatically on a fresh schema (app.core.bootstrap_db).

Run: python -m scripts.seed
"""
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import SessionLocal  # noqa: E402
from app.core.seed_data import load_required  # noqa: E402
from app.dao import leave_type_dao, leave_year_dao, notification_template_dao, org_structure_dao, role_dao  # noqa: E402
from app.models.org_structure import Role  # noqa: E402
from app.services import config_service, leave_year_service, suite_access_service  # noqa: E402
from app.services.employee.directory import resolve_department_id  # noqa: E402
from app.services.suite_provision_service import UNASSIGNED_DEPARTMENT  # noqa: E402


def reference() -> dict:
    return load_required("reference.json")


def current_leave_year_bounds(start_month_day: str) -> tuple[date, date, str]:
    """Kept as a thin wrapper over leave_year_service so the seed and the admin screen can
    never disagree about where a leave year starts."""
    return leave_year_service.bounds_from(start_month_day)


def seed_roles(db, ref: dict):
    for role in ref["roles"]:
        if role_dao.find_role_by_code(db, role["code"]) is None:
            db.add(Role(role_code=role["code"], role_name=role["name"]))
    db.commit()


def seed_management_levels(db, ref: dict):
    for level in ref["management_levels"]:
        if org_structure_dao.find_management_level_by_code(db, level["code"]) is None:
            org_structure_dao.create_management_level(
                db, level_code=level["code"], level_name=level["name"], level_rank=level["rank"],
            )


# No leave type is ever created here — not a company's own, and not LOP or Compensatory Off.
# A deployment must come up with an empty Leave types screen that only an authorised admin
# fills in; `scripts/seed_company_policy.py --confirm` is the one deliberate way to load a
# prepared policy file, and it is never called from a boot path.


def seed_leave_year(db, ref: dict):
    """The first leave year, from the configured start (seed/reference.json's
    `leave_year.start_month_day`) — never a hardcoded 04-01. Later years are created by HR
    through POST /api/admin/leave-years; nothing here ever moves an existing year."""
    start_month_day = ref["config_defaults"][leave_year_service.CONFIG_KEY]["value"]
    start, end, code = current_leave_year_bounds(start_month_day)
    if leave_year_dao.find_by_code(db, code) is None:
        leave_year_dao.create(db, year_code=code, start_date=start, end_date=end, is_current=True)


def seed_notification_templates(db, ref: dict):
    # FRD Section 6 event keys - mirrors seed.js's `templates` list verbatim.
    for tpl in ref["notification_templates"]:
        if notification_template_dao.find_by_key(db, tpl["key"]) is None:
            notification_template_dao.create(
                db, template_key=tpl["key"], subject_template=tpl["subject"], body_template=tpl["body"],
            )


def run():
    ref = reference()  # before any write: a missing file must not half-seed the database
    db = SessionLocal()
    try:
        seed_roles(db, ref)
        seed_management_levels(db, ref)
        config_service.seed_defaults(db, updated_by=None)
        seed_leave_year(db, ref)
        seed_notification_templates(db, ref)
        resolve_department_id(db, UNASSIGNED_DEPARTMENT)  # find-or-create
        suite_access_service.sync_all(db)
        db.commit()
        print("OK: reference data seeded (no leave types — an admin creates those).")
    finally:
        db.close()


if __name__ == "__main__":
    run()
