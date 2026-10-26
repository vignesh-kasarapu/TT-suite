"""Mirrors backend/src/services/admin.service.js's Department/Region/Grade/
Project sections: "simple masters, no hardcoded values anywhere else". No
application-level duplicate-code check — a duplicate code/name surfaces as a
DUPLICATE_VALUE 409 via the DB's unique constraint (same as Node, which lets
Sequelize's raw UniqueConstraintError bubble up)."""
from sqlalchemy.orm import Session

from app.dao import org_structure_dao
from app.services import audit_service


def list_departments(db: Session):
    return org_structure_dao.list_departments(db)


def create_department(db: Session, department_code: str, department_name: str, actor_id: int):
    row = org_structure_dao.create_department(db, department_code=department_code, department_name=department_name)
    audit_service.record(
        db, action="DEPARTMENT_CREATED", entity_type="departments", entity_id=row.department_id,
        actor_id=actor_id, new_value={"department_code": department_code, "department_name": department_name},
    )
    return row


def list_regions(db: Session):
    return org_structure_dao.list_regions(db)


def create_region(db: Session, region_code: str, region_name: str, actor_id: int):
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
