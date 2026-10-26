from datetime import date

from pydantic import BaseModel, ConfigDict

from app.schemas.base import CamelOut


class HolidayOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    holiday_id: int
    holiday_date: date
    holiday_name: str
    leave_year_id: int
    region_id: int | None
    is_optional: bool


class HolidayCreateIn(BaseModel):
    holiday_date: date
    holiday_name: str
    leave_year_id: int
    region_id: int | None = None
    is_optional: bool = False


class HolidayAddedOut(CamelOut):
    """Node hand-builds { holiday, affectedRequestIds } — holiday is a real
    model (snake_case inside, untouched); affectedRequestIds is a derived
    camelCase array with no snake_case counterpart. See app/schemas/base.py."""

    holiday: HolidayOut
    affected_request_ids: list[int]
