"""Mirrors backend/src/services/admin.service.js's Department/Region/Grade/
Project sections: "simple masters, no hardcoded values anywhere else". No
application-level duplicate-code check — a duplicate code/name surfaces as a
DUPLICATE_VALUE 409 via the DB's unique constraint (same as Node, which lets
Sequelize's raw UniqueConstraintError bubble up)."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import org_structure_dao
from app.services import audit_service


def list_departments(db: Session):
    return org_structure_dao.list_departments(db)


def unique_code(name: str, taken) -> str:
    """NAME -> UPPER_SNAKE (max 24), deduped with a numeric suffix while `taken(code)` is true."""
    base = "".join(c if c.isalnum() else "_" for c in name.upper()).strip("_")[:24] or "ITEM"
    code, suffix = base, 1
    while taken(code):
        tail = f"_{suffix}"
        code = f"{base[:24 - len(tail)]}{tail}"
        suffix += 1
    return code


def _clean_name(name: str, kind: str) -> str:
    name = (name or "").strip()
    if not name:
        raise AppError("VALIDATION_ERROR", f"{kind} name is required.")
    if len(name) > 100:
        raise AppError("VALIDATION_ERROR", f"{kind} name can be at most 100 characters.")
    return name


def create_department(db: Session, department_code: str | None, department_name: str, actor_id: int):
    department_name = _clean_name(department_name, "Department")
    if org_structure_dao.find_department_by_name(db, department_name) is not None:
        raise AppError("DUPLICATE_VALUE", f"A department named {department_name} already exists.", status=409)
    department_code = (department_code or "").strip() or unique_code(
        department_name, lambda c: org_structure_dao.find_department_by_code(db, c) is not None
    )
    row = org_structure_dao.create_department(db, department_code=department_code, department_name=department_name)
    audit_service.record(
        db, action="DEPARTMENT_CREATED", entity_type="departments", entity_id=row.department_id,
        actor_id=actor_id, new_value={"department_code": department_code, "department_name": department_name},
    )
    return row


def rename_department(db: Session, department_id: int, department_name: str, actor_id: int):
    row = org_structure_dao.get_department(db, department_id)
    if row is None:
        raise AppError("NOT_FOUND", "Department not found.", status=404)
    department_name = _clean_name(department_name, "Department")
    same = org_structure_dao.find_department_by_name(db, department_name)
    if same is not None and same.department_id != department_id:
        raise AppError("DUPLICATE_VALUE", f"A department named {department_name} already exists.", status=409)
    old = row.department_name
    org_structure_dao.rename(db, row, department_name=department_name)
    audit_service.record(
        db, action="DEPARTMENT_RENAMED", entity_type="departments", entity_id=department_id,
        actor_id=actor_id, prior_value={"department_name": old}, new_value={"department_name": department_name},
    )
    return row


def list_regions(db: Session):
    return org_structure_dao.list_regions(db)


def create_region(db: Session, region_code: str | None, region_name: str, actor_id: int):
    region_name = _clean_name(region_name, "Region")
    if org_structure_dao.find_region_by_name(db, region_name) is not None:
        raise AppError("DUPLICATE_VALUE", f"A region named {region_name} already exists.", status=409)
    region_code = (region_code or "").strip() or unique_code(
        region_name, lambda c: org_structure_dao.find_region_by_code(db, c) is not None
    )
    row = org_structure_dao.create_region(db, region_code=region_code, region_name=region_name)
    audit_service.record(
        db, action="REGION_CREATED", entity_type="regions", entity_id=row.region_id,
        actor_id=actor_id, new_value={"region_code": region_code, "region_name": region_name},
    )
    return row


def list_grades(db: Session):
    return org_structure_dao.list_grades(db)


def create_grade(db: Session, grade_code: str, grade_name: str, actor_id: int):
    row = org_structure_dao.create_grade(db, grade_code=grade_code, grade_name=grade_name)
    audit_service.record(
        db, action="GRADE_CREATED", entity_type="grades", entity_id=row.grade_id,
        actor_id=actor_id, new_value={"grade_code": grade_code, "grade_name": grade_name},
    )
    return row


def list_management_levels(db: Session):
    return org_structure_dao.list_management_levels(db)


def list_projects(db: Session):
    return org_structure_dao.list_projects(db)


def create_project(db: Session, project_code: str, project_name: str, actor_id: int):
    row = org_structure_dao.create_project(db, project_code=project_code, project_name=project_name)
    audit_service.record(
        db, action="PROJECT_CREATED", entity_type="projects", entity_id=row.project_id,
        actor_id=actor_id, new_value={"project_code": project_code, "project_name": project_name},
    )
    return row


# LMS-013: assignments may overlap freely — no exclusivity check here (contrast
# with WorkingPatternAssignment's LMS-015, which forbids overlap).
def assign_project(db: Session, payload: dict, actor_id: int):
    row = org_structure_dao.create_project_assignment(
        db,
        employee_id=payload["employee_id"],
        project_id=payload["project_id"],
        project_lead_id=payload["project_lead_id"],  # drives an auto-Watcher, LMS-014
        effective_from=payload["effective_from"],
        effective_to=payload.get("effective_to"),
        created_by=actor_id,
    )
    audit_service.record(
        db, action="PROJECT_ASSIGNMENT_CREATED", entity_type="project_assignments", entity_id=row.assignment_id,
        actor_id=actor_id, new_value=payload,
    )
    return row


def rename_region(db: Session, region_id: int, region_name: str, actor_id: int):
    row = org_structure_dao.get_region(db, region_id)
    if row is None:
        raise AppError("NOT_FOUND", "Region not found.", status=404)
    region_name = _clean_name(region_name, "Region")
    same = org_structure_dao.find_region_by_name(db, region_name)
    if same is not None and same.region_id != region_id:
        raise AppError("DUPLICATE_VALUE", f"A region named {region_name} already exists.", status=409)
    old = row.region_name
    org_structure_dao.rename(db, row, region_name=region_name)
    audit_service.record(
        db, action="REGION_RENAMED", entity_type="regions", entity_id=region_id,
        actor_id=actor_id, prior_value={"region_name": old}, new_value={"region_name": region_name},
    )
    return row
