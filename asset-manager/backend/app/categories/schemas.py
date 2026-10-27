from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator


class CategoryCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Unique category name")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Category name cannot be blank")
        return cleaned


class CategoryUpdateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Unique category name")

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Category name cannot be blank")
        return cleaned


class CategoryResponse(BaseModel):
    id: int
    name: str
    total_assets: int = 0
    available_assets: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
