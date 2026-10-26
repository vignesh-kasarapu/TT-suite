"""Department/Region/Grade/ManagementLevel/Project — simple reference-data CRUD
(Node groups these together: "simple masters, no hardcoded values anywhere else")."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.org_structure import Department, Grade, ManagementLevel, Project, ProjectAssignment, Region


def list_departments(db: Session) -> list[Department]:
    return list(db.execute(select(Department).order_by(Department.department_name)).scalars())


def find_department_by_name(db: Session, name: str) -> Department | None:
    # Lookups by name/code are case-insensitive, as they were under MySQL's collation.
    return db.execute(select(Department).where(func.lower(Department.department_name) == name.strip().lower())).scalars().first()


def find_department_by_code(db: Session, code: str) -> Department | None:
    return db.execute(select(Department).where(func.lower(Department.department_code) == code.strip().lower())).scalars().first()


def create_department(db: Session, **fields) -> Department:
    row = Department(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_regions(db: Session) -> list[Region]:
    return list(db.execute(select(Region).order_by(Region.region_name)).scalars())


def find_region_by_code(db: Session, code: str) -> Region | None:
    return db.execute(select(Region).where(func.lower(Region.region_code) == code.strip().lower())).scalars().first()


def create_region(db: Session, **fields) -> Region:
    row = Region(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_grades(db: Session) -> list[Grade]:
    return list(db.execute(select(Grade).order_by(Grade.grade_code)).scalars())


def create_grade(db: Session, **fields) -> Grade:
    row = Grade(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_management_levels(db: Session) -> list[ManagementLevel]:
    return list(db.execute(select(ManagementLevel).order_by(ManagementLevel.level_rank)).scalars())


def find_management_level_by_code(db: Session, code: str) -> ManagementLevel | None:
    return db.execute(select(ManagementLevel).where(func.lower(ManagementLevel.level_code) == code.strip().lower())).scalars().first()


def create_management_level(db: Session, **fields) -> ManagementLevel:
    row = ManagementLevel(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_projects(db: Session) -> list[Project]:
    return list(db.execute(select(Project).order_by(Project.project_name)).scalars())


def create_project(db: Session, **fields) -> Project:
    row = Project(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def create_project_assignment(db: Session, **fields) -> ProjectAssignment:
    row = ProjectAssignment(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_active_assignments_for_employee(db: Session, employee_id: int, start_date, end_date) -> list[ProjectAssignment]:
    """LMS-014: project assignments covering the whole requested span, for
    auto-Watcher-on-submit (the assignment's project_lead_id becomes a Watcher)."""
    return list(
        db.execute(
            select(ProjectAssignment).where(
                ProjectAssignment.employee_id == employee_id,
                ProjectAssignment.effective_from <= start_date,
                (ProjectAssignment.effective_to.is_(None)) | (ProjectAssignment.effective_to >= end_date),
            )
        ).scalars()
    )
