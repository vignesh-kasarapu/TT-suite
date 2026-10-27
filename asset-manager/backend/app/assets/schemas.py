from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from app.common.enums import AssetStatus


def _blank_to_none(v: str | None) -> str | None:
    if v is None:
        return None
    cleaned = v.strip()
    return cleaned or None


class AssetCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    serial_no: str = Field(..., min_length=1, max_length=255)
    service_tag: str | None = Field(default=None, max_length=255)
    asset_tag: str | None = Field(default=None, max_length=255)
    category_id: int | None = Field(default=None, ge=1)
    category: int | str | None = Field(
        default=None,
        description="Optional category ID or name if category_id is not provided",
    )
    purchase_date: date
    cost: Decimal = Field(..., ge=Decimal("0.00"))
    location: str = Field(..., min_length=1, max_length=255)

    @field_validator("name", "serial_no", "location")
    @classmethod
    def validate_not_blank(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Field cannot be blank")
        return cleaned

    @field_validator("service_tag", "asset_tag", mode="before")
    @classmethod
    def validate_optional_tags(cls, v: str | None) -> str | None:
        return _blank_to_none(v)


class AssetUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category_id: int | None = Field(default=None, ge=1)
    category: int | str | None = Field(default=None)
    purchase_date: date | None = None
    cost: Decimal | None = Field(default=None, ge=Decimal("0.00"))
    location: str | None = Field(default=None, min_length=1, max_length=255)
    serial_no: str | None = Field(default=None, min_length=1, max_length=255)
    service_tag: str | None = Field(default=None, max_length=255)
    asset_tag: str | None = Field(default=None, max_length=255)
    tag: str | None = Field(
        default=None,
        description="Immutable Asset ID; any modification is rejected",
    )

    @field_validator("name", "location", "serial_no")
    @classmethod
    def validate_optional_not_blank(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Field cannot be blank")
        return cleaned

    @field_validator("service_tag", "asset_tag", mode="before")
    @classmethod
    def validate_optional_clearable(cls, v: str | None) -> str | None:
        return _blank_to_none(v)


class AssetResponse(BaseModel):
    id: int
    tag: str = Field(description="Auto-generated immutable Asset ID")
    name: str
    serial_no: str
    service_tag: str | None = None
    asset_tag: str | None = None
    category_id: int
    category_name: str | None = None
    purchase_date: date
    cost: Decimal
    location: str
    status: AssetStatus
    awaiting_employee_details: bool = False
    version: int
    created_at: datetime
    assigned_to_name: str | None = Field(
        default=None,
        description="Employee name for the open assignment; null when unassigned",
    )

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("cost")
    def serialize_cost(self, value: Decimal) -> float:
        return round(float(value), 2)


class PaginatedAssetsResponse(BaseModel):
    items: list[AssetResponse]
    total: int
    page: int
    size: int
    pages: int


class AssetBulkImportRequest(BaseModel):
    excel_base64: str | None = Field(
        default=None,
        description="Base64-encoded Excel (.xlsx) workbook",
    )
    csv_content: str | None = Field(
        default=None,
        description="Optional Excel TSV copy-paste or CSV text including header row",
    )


class AssetImportRowError(BaseModel):
    row: int
    identifier: str
    message: str


class AssetBulkImportResponse(BaseModel):
    total_rows: int
    imported_count: int
    skipped_count: int
    created_categories: list[str] = Field(default_factory=list)
    imported_items: list[AssetResponse]
    errors: list[AssetImportRowError]
