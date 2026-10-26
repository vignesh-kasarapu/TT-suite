from sqlalchemy.orm import Session

from app.dao import employee_dao, org_structure_dao


def list_employees(db: Session, *, search: str | None = None, department_id: int | None = None, grade_id: int | None = None):
    return employee_dao.list_all(db, search=search, department_id=department_id, grade_id=grade_id)


def resolve_department_id(db: Session, department_name: str) -> int:
    """Find-or-create a department by name, deriving a unique code
    (NAME -> UPPER_SNAKE, deduped with a numeric suffix) — mirrors
    employee.service.js's resolveDepartmentId exactly."""
    name = department_name.strip()
    department = org_structure_dao.find_department_by_name(db, name)
    if department is not None:
        return department.department_id

    base_code = "".join(c if c.isalnum() else "_" for c in name.upper()).strip("_")[:24] or "DEPARTMENT"
    code = base_code
    suffix = 1
    while org_structure_dao.find_department_by_code(db, code) is not None:
        suffix_str = f"_{suffix}"
        code = f"{base_code[:24 - len(suffix_str)]}{suffix_str}"
        suffix += 1

    department = org_structure_dao.create_department(db, department_code=code, department_name=name)
    return department.department_id
