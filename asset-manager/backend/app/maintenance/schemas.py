from datetime import date as DateType, datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator

from app.common.enums import OldAssetAction, ReplacementStatus, UserRole


class MaintenanceCreateRequest(BaseModel):
    opened_on: DateType | None = Field(
        default=None, description="Date maintenance opened (defaults to today)"
    )
    date: DateType | None = Field(default=None, description="Alias for opened_on")
    description: str = Field(..., min_length=1, max_length=2000)
    cost: Decimal | None = Field(default=None, ge=Decimal("0.00"))

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Maintenance description cannot be blank")
        return cleaned

    @model_validator(mode="after")
    def resolve_opened_on(self) -> "MaintenanceCreateRequest":
        if self.opened_on is None:
            self.opened_on = self.date or DateType.today()
        return self


class MaintenanceCloseRequest(BaseModel):
    closed_on: DateType | None = Field(
        default=None, description="Date maintenance closed (defaults to today)"
    )
    cost: Decimal | None = Field(default=None, ge=Decimal("0.00"))
    description: str | None = Field(default=None, max_length=2000)
    resolution: str = Field(
        ...,
        min_length=1,
        max_length=2000,
        description="Resolution note written when closing maintenance",
    )

    @field_validator("description")
    @classmethod
    def validate_optional_description(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Maintenance description cannot be blank")
        return cleaned

    @field_validator("resolution")
    @classmethod
    def validate_resolution(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Resolution note is required when closing maintenance")
        return cleaned


class MaintenanceRecordResponse(BaseModel):
    id: int
    asset_id: int
    asset_tag: str | None = None
    asset_name: str | None = None
    replacement_request_id: int | None = None
    opened_on: DateType
    closed_on: DateType | None = None
    description: str
    resolution: str | None = None
    cost: Decimal | None = None
    created_at: datetime
    # Enriched requester display (legacy; prefer employee_name in UI)
    requested_by_name: str | None = None
    requested_by_role: UserRole | None = None
    # Employee who held the asset (replacement requester or assignee at return-to-maintenance)
    employee_name: str | None = None
    reason: str | None = None
    temporary: bool | None = None
    old_asset_action: OldAssetAction | None = None
    replacement_status: ReplacementStatus | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("cost")
    def serialize_cost(self, value: Decimal | None) -> float | None:
        if value is None:
            return None
        return round(float(value), 2)
