from datetime import date

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.base import CamelOut
from app.schemas.leave_type import _blank_to_none


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

    # "All regions (org-wide)" is an empty <select> value.
    _blank_region = field_validator("region_id", mode="before")(_blank_to_none)


class HolidayUpdateIn(BaseModel):
    """An edit keeps the holiday in its own leave year; everything else can change."""
    holiday_date: date
    holiday_name: str
    region_id: int | None = None
    is_optional: bool = False

    _blank_region = field_validator("region_id", mode="before")(_blank_to_none)


class HolidayUpdatedOut(CamelOut):
    holiday: HolidayOut
    affected_request_ids: list[int]
    removed_selections: int  # optional picks dropped because the day became a holiday for everyone


class HolidayAddedOut(CamelOut):
    """Node hand-builds { holiday, affectedRequestIds } — holiday is a real
    model (snake_case inside, untouched); affectedRequestIds is a derived
    camelCase array with no snake_case counterpart. See app/schemas/base.py."""

    holiday: HolidayOut
    affected_request_ids: list[int]
