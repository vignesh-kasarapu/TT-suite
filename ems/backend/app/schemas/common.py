from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer

# Money is stored as Decimal and sent to the browser as a JSON number.
Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserBrief(ORM):
    id: int
    full_name: str
    employee_code: str
    department: str
    roles: list[str]


class ReasonIn(BaseModel):
    reason: str


class Message(BaseModel):
    message: str
