from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr

from app.common.enums import UserRole


class AuthUserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: UserRole
    active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
