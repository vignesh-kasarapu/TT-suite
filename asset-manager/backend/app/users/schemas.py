from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.common.enums import UserRole


class UserCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    role: UserRole = Field(default=UserRole.EMPLOYEE)
    active: bool = Field(default=True)

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name cannot be blank")
        return cleaned


class UserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    role: UserRole | None = None
    active: bool | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Name cannot be blank")
        return cleaned


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: UserRole
    active: bool
    active_assets_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PaginatedUsersResponse(BaseModel):
    items: list[UserResponse]
    total: int
    page: int
    size: int
    pages: int


class RoleChangeRequest(BaseModel):
    """A request to the global admin. Suite role: employee, manager or admin; null = remove access."""
    role: str | None = None
    note: str = Field(default="", max_length=1000)


class RoleChangeRequestResponse(BaseModel):
    id: int
    role: str | None
    message: str = "Sent to the global admin for approval."


class RoleRequestResponse(BaseModel):
    id: int
    email: str
    role: str | None
    requested_at: datetime
    requested_by: str | None = None
