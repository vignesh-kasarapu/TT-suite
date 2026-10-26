"""The only place that touches a SQLAlchemy Session for Employee queries. One
query per method, no business rules here — see services/employee/* for the
resolution/validation logic that calls these."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.employee import Employee


def find_by_id(db: Session, employee_id: int) -> Employee | None:
    return db.get(Employee, employee_id)


def find_by_entra_oid(db: Session, entra_oid: str) -> Employee | None:
    return db.execute(select(Employee).where(Employee.entra_oid == entra_oid)).scalar_one_or_none()


def find_by_work_email(db: Session, work_email: str) -> Employee | None:
    # Deliberately an exact match, never a LIKE/ilike — avoids a claimed email
    # binding to the wrong account via SQL wildcard characters (LMS-003). Compared
    # lower-cased: MySQL's collation was case-insensitive, PostgreSQL is not (the
    # ux_users_email_lower index keeps it unique on the same expression).
    return db.execute(
        select(Employee).where(func.lower(Employee.work_email) == (work_email or "").strip().lower())
    ).scalar_one_or_none()


def find_by_employee_code(db: Session, employee_code: str) -> Employee | None:
    # Case-insensitive like the MySQL collation it replaces (ux_users_employee_code_lower).
    return db.execute(
        select(Employee).where(func.lower(Employee.employee_code) == (employee_code or "").strip().lower())
    ).scalar_one_or_none()


def find_by_suite_user_id(db: Session, suite_user_id: str) -> Employee | None:
    return db.execute(select(Employee).where(Employee.suite_user_id == suite_user_id)).scalar_one_or_none()


def bind_entra_oid(db: Session, employee: Employee, entra_oid: str) -> None:
    employee.entra_oid = entra_oid
    db.add(employee)
    db.commit()
    db.refresh(employee)


def list_all(db: Session, *, search: str | None = None, department_id: int | None = None, grade_id: int | None = None) -> list[Employee]:
    stmt = select(Employee)
    if department_id is not None:
        stmt = stmt.where(Employee.department_id == department_id)
    if grade_id is not None:
        stmt = stmt.where(Employee.grade_id == grade_id)
    if search:
        like = f"%{search}%"
        # ilike: MySQL's LIKE was case-insensitive under its collation; PostgreSQL's is not.
        stmt = stmt.where((Employee.first_name.ilike(like)) | (Employee.last_name.ilike(like)) | (Employee.employee_code.ilike(like)))
    stmt = stmt.order_by(Employee.first_name, Employee.last_name)
    return list(db.execute(stmt).scalars())


def list_active(db: Session) -> list[Employee]:
    return list(db.execute(select(Employee).where(Employee.is_active.is_(True))).scalars())


def list_direct_reports(db: Session, manager_id: int) -> list[Employee]:
    return list(db.execute(select(Employee).where(Employee.reporting_manager_id == manager_id)).scalars())


def create(db: Session, **fields) -> Employee:
    row = Employee(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update(db: Session, employee: Employee, updates: dict) -> Employee:
    for key, value in updates.items():
        setattr(employee, key, value)
    db.add(employee)
    db.commit()
    db.refresh(employee)
    return employee
