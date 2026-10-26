from datetime import date

from pydantic import BaseModel, ConfigDict


class DepartmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    department_id: int
    department_code: str
    department_name: str
    is_active: bool


class DepartmentCreateIn(BaseModel):
    department_code: str
    department_name: str


class RegionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    region_id: int
    region_code: str
    region_name: str
    is_active: bool


class RegionCreateIn(BaseModel):
    region_code: str
    region_name: str


class GradeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    grade_id: int
    grade_code: str
    grade_name: str
    is_active: bool


class GradeCreateIn(BaseModel):
    grade_code: str
    grade_name: str


class ManagementLevelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    management_level_id: int
    level_code: str
    level_name: str
    level_rank: int
    is_active: bool


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    project_id: int
    project_code: str
    project_name: str
    is_active: bool


class ProjectCreateIn(BaseModel):
    project_code: str
    project_name: str


class ProjectAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    assignment_id: int
    employee_id: int
    project_id: int
    project_lead_id: int
    effective_from: date
    effective_to: date | None


class ProjectAssignmentCreateIn(BaseModel):
    employee_id: int
    project_id: int
    project_lead_id: int
    effective_from: date
    effective_to: date | None = None
