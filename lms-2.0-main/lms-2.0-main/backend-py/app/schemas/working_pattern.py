from datetime import date

from pydantic import BaseModel, ConfigDict


class WorkingPatternOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    working_pattern_id: int
    pattern_code: str
    pattern_name: str
    weekend_days: str  # JSON-encoded array, matching the Node wire format verbatim
    is_active: bool


class WorkingPatternCreateIn(BaseModel):
    pattern_code: str
    pattern_name: str
    weekend_days: list[str]  # weekday codes, e.g. ["SAT","SUN"] — matches config.py's weekend.days


class WorkingPatternAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    assignment_id: int
    employee_id: int
    working_pattern_id: int
    effective_from: date
    effective_to: date | None


class WorkingPatternAssignmentDetailOut(WorkingPatternAssignmentOut):
    employee_full_name: str
    employee_code: str
    pattern_name: str
    pattern_code: str


class WorkingPatternAssignmentCreateIn(BaseModel):
    employee_id: int
    working_pattern_id: int
    effective_from: date
    effective_to: date | None = None


class WorkingPatternAssignmentUpdateIn(BaseModel):
    working_pattern_id: int | None = None
    effective_from: date | None = None
    effective_to: date | None = None
