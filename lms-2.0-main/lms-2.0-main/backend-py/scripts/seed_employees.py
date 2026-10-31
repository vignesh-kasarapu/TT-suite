"""Loads the demo roster from seed/demo.json (`employees`). Idempotent: existing codes
are left alone. Run after scripts.seed:  python -m scripts.seed_employees

Refuses to run (before touching anything) under APP_PROFILE=prod, and when seed/demo.json is
missing - which it always is on a fresh clone, in the image and in the deploy package, since
the file is gitignored. Copy seed/demo.example.json to seed/demo.json to build a local demo."""
from datetime import date

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.seed_data import load_optional, seed_dir
from app.models.employee import Employee
from app.services import role_assignment_service, suite_access_service


def demo_data(script: str) -> dict:
    """The local demo file, or a refusal: never on production, never without the file."""
    if settings.is_production:
        raise SystemExit(f"{script} is for dev and trial databases; APP_PROFILE=prod refuses it")
    data = load_optional("demo.json")
    if data is None:
        raise SystemExit(
            f"{script}: no demo data ({seed_dir() / 'demo.json'} is missing). It is local-only and gitignored; "
            f"copy {seed_dir() / 'demo.example.json'} to demo.json to build a demo org."
        )
    return data


def run():
    roster = demo_data("seed_employees")["employees"]
    db = SessionLocal()
    try:
        by_code = {}
        for person in roster:
            code, first, last, email = person["code"], person["first_name"], person["last_name"], person["email"]
            manager_code, roles, active = person["manager_code"], person["roles"], person["active"]
            employee = db.query(Employee).filter_by(employee_code=code).first()
            if employee is None:
                employee = Employee(
                    employee_code=code, first_name=first, last_name=last, work_email=email, date_of_joining=date(2024, 4, 1),
                    designation="Manager" if "MANAGER" in roles else "HR Admin" if "HR_ADMIN" in roles else "Employee",
                    reporting_manager_id=by_code[manager_code].employee_id if manager_code else None, is_active=active,
                )
                db.add(employee)
                db.commit()
                db.refresh(employee)
                for role in roles:
                    role_assignment_service.assign_role(db, employee.employee_id, role, by_code.get("EMP001", employee).employee_id)
                print(f"created {code} {first} {last}")
            else:
                print(f"exists  {code}")
            by_code[code] = employee
        # TT Suite: mirror every roster employee's effective LMS role (idempotent).
        suite_access_service.sync_all(db)
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    run()
