from pydantic import BaseModel


class CarryForwardTriggerIn(BaseModel):
    leave_year_id: int
