"""Loads the demo roster (EMP001-EMP010 + EMP012). Idempotent: existing codes
are left alone. Run after scripts.seed:  python -m scripts.seed_employees"""
from datetime import date

from app.core.db import SessionLocal
from app.models.employee import Employee
from app.services import role_assignment_service, suite_access_service

# code, first, last, email, manager_code, roles, active
ROSTER = [
    ("EMP001", "Asha", "Rao", "asha.rao@example.com", None, ["EMPLOYEE", "HR_ADMIN"], True),
    ("EMP002", "Vikram", "Shah", "vikram.shah@example.com", "EMP001", ["EMPLOYEE", "MANAGER"], True),
    ("EMP005", "Neha", "Kapoor", "neha.kapoor@example.com", "EMP001", ["EMPLOYEE", "MANAGER"], True),
    ("EMP003", "Priya", "Nair", "priya.nair@example.com", "EMP002", ["EMPLOYEE"], True),
    ("EMP004", "Rohan", "Mehta", "rohan.mehta@example.com", "EMP002", ["EMPLOYEE"], True),
    ("EMP006", "Arjun", "Desai", "arjun.desai@example.com", "EMP005", ["EMPLOYEE"], True),
    ("EMP007", "Kavya", "Iyer", "kavya.iyer@example.com", "EMP005", ["EMPLOYEE"], True),
    ("EMP008", "Sanjay", "Verma", "sanjay.verma@example.com", "EMP002", ["EMPLOYEE"], False),
    ("EMP009", "Meera", "Joshi", "meera.joshi@example.com", "EMP002", ["EMPLOYEE"], True),
    ("EMP010", "Aditya", "Rao", "aditya.rao@example.com", "EMP005", ["EMPLOYEE"], True),
    ("EMP012", "SRIKARAN", "BOYINI", "srikaran.b@tektalis.com", "EMP001", ["EMPLOYEE"], True),
]


def run():
    db = SessionLocal()
    try:
        by_code = {}
        for code, first, last, email, manager_code, roles, active in ROSTER:
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
