"""Thin — mirrors the Department/Region/Grade/ManagementLevel/Project section
of backend/src/routes/admin.routes.js. HR_ADMIN only (router-level in Node;
applied per-dependency here since FastAPI has no router-wide guard shortcut)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.schemas.org_structure import (
    DepartmentCreateIn,
    DepartmentOut,
    GradeCreateIn,
    GradeOut,
    ManagementLevelOut,
    ProjectAssignmentCreateIn,
    ProjectAssignmentOut,
    ProjectCreateIn,
    ProjectOut,
    RegionCreateIn,
    RegionOut,
)
from app.services import org_structure_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


@router.get("/departments")
def list_departments(db: Session = Depends(get_db)):
    rows = org_structure_service.list_departments(db)
    return ok([DepartmentOut.model_validate(r).model_dump() for r in rows])


@router.post("/departments", status_code=201)
def create_department(payload: DepartmentCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = org_structure_service.create_department(db, payload.department_code, payload.department_name, user.employee_id)
    return created(DepartmentOut.model_validate(row).model_dump())


@router.get("/regions")
def list_regions(db: Session = Depends(get_db)):
    rows = org_structure_service.list_regions(db)
    return ok([RegionOut.model_validate(r).model_dump() for r in rows])


@router.post("/regions", status_code=201)
def create_region(payload: RegionCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = org_structure_service.create_region(db, payload.region_code, payload.region_name, user.employee_id)
    return created(RegionOut.model_validate(row).model_dump())


@router.get("/grades")
def list_grades(db: Session = Depends(get_db)):
    rows = org_structure_service.list_grades(db)
    return ok([GradeOut.model_validate(r).model_dump() for r in rows])


@router.post("/grades", status_code=201)
def create_grade(payload: GradeCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = org_structure_service.create_grade(db, payload.grade_code, payload.grade_name, user.employee_id)
    return created(GradeOut.model_validate(row).model_dump())


@router.get("/management-levels")
def list_management_levels(db: Session = Depends(get_db)):
    rows = org_structure_service.list_management_levels(db)
    return ok([ManagementLevelOut.model_validate(r).model_dump() for r in rows])


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    rows = org_structure_service.list_projects(db)
    return ok([ProjectOut.model_validate(r).model_dump() for r in rows])


@router.post("/projects", status_code=201)
def create_project(payload: ProjectCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = org_structure_service.create_project(db, payload.project_code, payload.project_name, user.employee_id)
    return created(ProjectOut.model_validate(row).model_dump())


@router.post("/project-assignments", status_code=201)
def assign_project(payload: ProjectAssignmentCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = org_structure_service.assign_project(db, payload.model_dump(), user.employee_id)
    return created(ProjectAssignmentOut.model_validate(row).model_dump())
