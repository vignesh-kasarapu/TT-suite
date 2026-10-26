from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.schemas.holiday import HolidayOut


class EligibleHolidayOut(HolidayOut):
    """Node spreads `{...holiday.toJSON(), isSelected}` — flat, not nested
    under a "holiday" key — so this inherits HolidayOut's fields directly
    rather than wrapping them. camelCase alias since this whole response is
    one of Node's hand-built objects (see app/schemas/base.py)."""

    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)
    is_selected: bool


class OptionalHolidaySummaryOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    quota: int
    taken: int
    remaining: int
    eligible_holidays: list[EligibleHolidayOut]


class OptionalHolidayUsageRowOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    employee_id: int
    full_name: str
    employee_code: str
    taken: int
    remaining: int


class OptionalHolidayUsageOut(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
    quota: int
    employees: list[OptionalHolidayUsageRowOut]
