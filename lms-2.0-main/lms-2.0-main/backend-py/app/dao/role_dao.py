from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.org_structure import EmployeeRole, Role


def find_role_by_code(db: Session, role_code: str) -> Role | None:
    return db.execute(select(Role).where(Role.role_code == role_code)).scalar_one_or_none()


def find_grant(db: Session, employee_id: int, role_id: int) -> EmployeeRole | None:
    return db.get(EmployeeRole, {"employee_id": employee_id, "role_id": role_id})


def create_grant(db: Session, employee_id: int, role_id: int) -> EmployeeRole:
    """Flushes only — role_assignment_service commits once the suite mirror
    (app.app_access) is written in the same transaction."""
    row = EmployeeRole(employee_id=employee_id, role_id=role_id)
    db.add(row)
    db.flush()
    return row


def delete_grant(db: Session, employee_id: int, role_id: int) -> None:
    """Flushes only — see create_grant."""
    row = find_grant(db, employee_id, role_id)
    if row is not None:
        db.delete(row)
        db.flush()


def count_holders(db: Session, role_id: int) -> int:
    return db.execute(
        select(func.count()).select_from(EmployeeRole).where(EmployeeRole.role_id == role_id)
    ).scalar_one()


def get_role_codes_for_employee(db: Session, employee_id: int) -> list[str]:
    """LMS-008: called fresh on every request — role membership is never trusted
    from a token, always re-read from the DB. Every authenticated user implicitly
    has EMPLOYEE regardless of explicit grants (mirrors auth.middleware.js)."""
    rows = db.execute(
        select(Role.role_code)
        .join(EmployeeRole, EmployeeRole.role_id == Role.role_id)
        .where(EmployeeRole.employee_id == employee_id)
    ).scalars().all()
    return sorted({"EMPLOYEE", *rows})


def has_role(db: Session, employee_id: int, role_code: str) -> bool:
    return role_code in get_role_codes_for_employee(db, employee_id)


def list_employee_ids_with_role(db: Session, role_code: str) -> list[int]:
    return list(
        db.execute(
            select(EmployeeRole.employee_id).join(Role, Role.role_id == EmployeeRole.role_id).where(Role.role_code == role_code)
        ).scalars()
    )


def find_hr_admin_queue_id(db: Session) -> int | None:
    """Only route to an active HR_ADMIN — a deactivated employee's role grant
    is never a valid escalation target. Ordered deterministically (lowest
    employee_id first) so the same admin is picked consistently across
    escalations."""
    from app.models.employee import Employee

    return db.execute(
        select(EmployeeRole.employee_id)
        .join(Role, Role.role_id == EmployeeRole.role_id)
        .join(Employee, Employee.employee_id == EmployeeRole.employee_id)
        .where(Role.role_code == "HR_ADMIN", Employee.is_active.is_(True))
        .order_by(EmployeeRole.employee_id.asc())
    ).scalars().first()
