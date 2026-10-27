from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator

from app.assets.schemas import AssetResponse
from app.common.enums import AssetRequestStatus


def _blank_to_none(v: str | None) -> str | None:
    if v is None:
        return None
    cleaned = v.strip()
    return cleaned or None


class AssetRequestCreate(BaseModel):
    """Employee submits category (or Other) plus a reason describing what/why."""

    category_id: int | None = Field(default=None, ge=1)
    is_other: bool = Field(default=False)
    other_category_name: str | None = Field(default=None, max_length=255)
    reason: str = Field(..., min_length=1, max_length=2000)

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Reason is required")
        return cleaned

    @field_validator("other_category_name", mode="before")
    @classmethod
    def validate_optional_name(cls, v: str | None) -> str | None:
        return _blank_to_none(v)

    @model_validator(mode="after")
    def validate_category_or_other(self) -> "AssetRequestCreate":
        if self.is_other:
            if not self.other_category_name:
                raise ValueError(
                    "other_category_name is required when requesting Outside catalogue (Other)"
                )
            self.category_id = None
        else:
            if self.category_id is None:
                raise ValueError("category_id is required unless is_other is true")
            self.other_category_name = None
        return self


class ApproveAssetRequest(BaseModel):
    """Approve with optional assign from inventory, or employee-register reminder when no stock."""

    category_id: int | None = Field(
        default=None,
        ge=1,
        description="Optional catalogue category to use when approving an Other request",
    )
    asset_id: int | None = Field(
        default=None,
        ge=1,
        description="AVAILABLE inventory asset of the request category to assign on approve",
    )
    requires_employee_register: bool = Field(
        default=False,
        description=(
            "Only when no AVAILABLE stock: remind the employee to register details. "
            "Ignored (forced false) when asset_id is provided."
        ),
    )
    comment: str | None = Field(default=None, max_length=2000)
    decision_comment: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def normalize_comment(self) -> "ApproveAssetRequest":
        raw = self.comment or self.decision_comment
        self.comment = raw.strip() if raw and raw.strip() else None
        if self.asset_id is not None:
            self.requires_employee_register = False
        return self


class AvailableAssetsForRequestResponse(BaseModel):
    """Backend stock check for the request category during approve."""

    category_id: int | None = None
    category_name: str | None = None
    has_available: bool
    items: list[AssetResponse] = Field(default_factory=list)


class RejectAssetRequest(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)
    decision_comment: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def normalize_comment(self) -> "RejectAssetRequest":
        raw = self.comment or self.decision_comment
        if raw is None or not raw.strip():
            raise ValueError("A rejection comment is required")
        self.comment = raw.strip()
        return self


class AssetRequestResponse(BaseModel):
    id: int
    requested_by: int
    requester_name: str | None = None
    requester_email: str | None = None
    name: str
    category_id: int | None = None
    category_name: str | None = None
    is_other: bool
    other_category_name: str | None = None
    other_reason: str | None = None
    reason: str
    serial_no: str | None = None
    service_tag: str | None = None
    asset_tag: str | None = None
    purchase_date: date | None = None
    cost: Decimal | None = None
    location: str | None = None
    status: AssetRequestStatus
    requires_employee_register: bool = False
    created_asset_id: int | None = None
    created_asset_tag: str | None = None
    decided_by: int | None = None
    decider_name: str | None = None
    decider_email: str | None = None
    decision_comment: str | None = None
    decided_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("cost")
    def serialize_cost(self, value: Decimal | None) -> float | None:
        if value is None:
            return None
        return round(float(value), 2)
