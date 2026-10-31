"""Reference-data seed, run once per fresh database — mirrors backend/src/utils/seed.js:
3 roles, 5 management levels, 5 org leave types + policy + accrual config, the system
LOP type, COMP_OFF, the current leave year, config defaults, and the "Unassigned"
department that TT Suite provisioning puts new people in. No employees created here
(see scripts/seed_demo.py for a populated demo org).

The values live in seed/reference.json (app.core.seed_data), not in this file; the logic
below is find-or-create, so re-running never duplicates or overwrites anything.

TT Suite: also mirrors every existing employee's effective LMS role into
app.app_access (idempotent backfill), so the portal's access matrix matches. Runs
automatically on a fresh schema (app.core.bootstrap_db).

Run: python -m scripts.seed
"""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import SessionLocal  # noqa: E402
from app.core.seed_data import load_required  # noqa: E402
from app.dao import leave_type_dao, leave_year_dao, notification_template_dao, org_structure_dao, role_dao  # noqa: E402
from app.models.org_structure import Role  # noqa: E402
from app.services import config_service, suite_access_service  # noqa: E402
from app.services.employee.directory import resolve_department_id  # noqa: E402
from app.services.suite_provision_service import UNASSIGNED_DEPARTMENT  # noqa: E402


def reference() -> dict:
    return load_required("reference.json")


def current_leave_year_bounds(start_month_day: str = "04-01") -> tuple[date, date, str]:
    month, day = (int(x) for x in start_month_day.split("-"))
    today = date.today()
    start_year = today.year if (today.month, today.day) >= (month, day) else today.year - 1
    start = date(start_year, month, day)
    end = date(start_year + 1, month, day) - timedelta(days=1)
    code = f"{start_year}-{start_year + 1}"
    return start, end, code


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


def seed_leave_types(db, ref: dict):
    for spec in ref["leave_types"]:
        code, is_sick, gender = spec["code"], spec["is_sick_leave"], spec["gender_eligibility"]
        lt = leave_type_dao.find_by_code(db, code)
        if lt is None:
            lt = leave_type_dao.create(
                db, type_code=code, type_name=spec["name"], is_sick_leave=is_sick, permits_half_day=True,
                permits_attachments=is_sick, gender_eligibility=gender,
            )
        elif lt.gender_eligibility != gender:
            lt.gender_eligibility = gender  # keeps an already-seeded database in step
        if leave_type_dao.find_policy(db, lt.leave_type_id) is None:
            leave_type_dao.create_policy(
                db, leave_type_id=lt.leave_type_id, annual_entitlement=spec["annual_entitlement"],
                carries_forward=spec["carries_forward"], carry_forward_cap=spec["carry_forward_cap"],
            )
        if leave_type_dao.find_accrual_config(db, lt.leave_type_id) is None:
            leave_type_dao.create_accrual_config(db, leave_type_id=lt.leave_type_id, accrual_method=spec["accrual_method"])

    # LOP and COMP_OFF: system types with no policy of their own.
    for spec in ref["system_leave_types"]:
        if leave_type_dao.find_by_code(db, spec["code"]) is None:
            fields = {k: v for k, v in spec.items() if k not in ("code", "name")}
            leave_type_dao.create(db, type_code=spec["code"], type_name=spec["name"], **fields)


def seed_leave_year(db):
    start, end, code = current_leave_year_bounds()
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
        seed_leave_types(db, ref)
        seed_leave_year(db)
        config_service.seed_defaults(db, updated_by=None)
        seed_notification_templates(db, ref)
        resolve_department_id(db, UNASSIGNED_DEPARTMENT)  # find-or-create
        suite_access_service.sync_all(db)
        db.commit()
        print("OK: reference data seeded.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
