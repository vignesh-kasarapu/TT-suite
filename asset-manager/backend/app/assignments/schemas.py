from datetime import date as DateType, datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field, field_serializer, model_validator

from app.assets.schemas import AssetResponse
from app.common.enums import AssetStatus, ReturnReason
from app.maintenance.schemas import MaintenanceRecordResponse


class AssignAssetRequest(BaseModel):
    user_id: int | None = Field(default=None, ge=1, description="Target employee/user ID")
    userId: int | None = Field(default=None, ge=1, description="Alias for user_id")
    assigned_on: DateType | None = Field(
        default=None, description="Assignment date (defaults to today)"
    )
    assignedOn: DateType | None = Field(default=None, description="Alias for assigned_on")

    @model_validator(mode="after")
    def normalize_fields(self) -> "AssignAssetRequest":
        resolved_user_id = self.user_id if self.user_id is not None else self.userId
        if resolved_user_id is None:
            raise ValueError("user_id is required")
        self.user_id = resolved_user_id
        self.assigned_on = self.assigned_on or self.assignedOn or DateType.today()
        return self


class ReturnAssetRequest(BaseModel):
    next_status: AssetStatus | None = Field(
        default=None,
        description="Target asset status after return: AVAILABLE, IN_MAINTENANCE, or RETIRED",
    )
    status: AssetStatus | None = Field(
        default=None,
        description="Alias for next_status",
    )
    nextStatus: AssetStatus | None = Field(
        default=None,
        description="CamelCase alias for next_status",
    )
    returned_on: DateType | None = Field(
        default=None, description="Return date (defaults to today)"
    )
    returnedOn: DateType | None = Field(default=None, description="Alias for returned_on")
    return_reason: ReturnReason | None = Field(default=ReturnReason.OTHER)
    returnReason: ReturnReason | None = Field(default=None)
    description: str | None = Field(
        default=None,
        description="Optional maintenance description when returning to IN_MAINTENANCE",
    )
    cost: Decimal | None = Field(
        default=None,
        ge=Decimal("0.00"),
        description="Optional maintenance cost when returning to IN_MAINTENANCE",
    )

    @model_validator(mode="after")
    def normalize_fields(self) -> "ReturnAssetRequest":
        if self.returnReason is not None:
            self.return_reason = self.returnReason
        if self.return_reason is None:
            self.return_reason = ReturnReason.OTHER

        # Reason IN_MAINTENANCE implies next status IN_MAINTENANCE
        if self.return_reason == ReturnReason.IN_MAINTENANCE:
            self.next_status = AssetStatus.IN_MAINTENANCE
        else:
            resolved_status = (
                self.next_status
                or self.status
                or self.nextStatus
                or AssetStatus.AVAILABLE
            )
            if resolved_status not in (
                AssetStatus.AVAILABLE,
                AssetStatus.IN_MAINTENANCE,
                AssetStatus.RETIRED,
            ):
                raise ValueError(
                    "Return next_status must be one of AVAILABLE, IN_MAINTENANCE, or RETIRED"
                )
            self.next_status = resolved_status

        if self.next_status == AssetStatus.IN_MAINTENANCE:
            cleaned = (self.description or "").strip()
            if not cleaned:
                raise ValueError(
                    "Maintenance reason/description is required when returning to IN_MAINTENANCE"
                )
            self.description = cleaned

        self.returned_on = self.returned_on or self.returnedOn or DateType.today()
        return self


class AssignmentResponse(BaseModel):
    id: int
    asset_id: int
    asset_tag: str | None = None
    asset_name: str | None = None
    user_id: int
    user_name: str | None = None
    user_email: str | None = None
    assigned_on: DateType
    returned_on: DateType | None = None
    return_reason: ReturnReason | None = None
    asset_status: AssetStatus | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EmployeeAssetDetailsRequest(BaseModel):
    """
    Employee one-time details fill.

    - When the held asset awaits full details (approved asset request): require
      name, serial_no, purchase_date, cost, location; optional tags.
    - Otherwise: allow filling blank service_tag / asset_tag only.
    """

    name: str | None = Field(default=None, max_length=255)
    serial_no: str | None = Field(default=None, max_length=255)
    service_tag: str | None = Field(default=None, max_length=255)
    asset_tag: str | None = Field(default=None, max_length=255)
    purchase_date: DateType | None = None
    cost: Decimal | None = Field(default=None, ge=Decimal("0.00"))
    location: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def normalize_fields(self) -> "EmployeeAssetDetailsRequest":
        if self.name is not None:
            cleaned = self.name.strip()
            self.name = cleaned or None
        if self.serial_no is not None:
            cleaned = self.serial_no.strip()
            self.serial_no = cleaned or None
        if self.service_tag is not None:
            cleaned = self.service_tag.strip()
            self.service_tag = cleaned or None
        if self.asset_tag is not None:
            cleaned = self.asset_tag.strip()
            self.asset_tag = cleaned or None
        if self.location is not None:
            cleaned = self.location.strip()
            self.location = cleaned or None
        return self


class AssignedAssetResponse(BaseModel):
    id: int
    tag: str = Field(description="Auto-generated immutable Asset ID")
    name: str
    serial_no: str
    service_tag: str | None = None
    asset_tag: str | None = Field(
        default=None,
        description="Optional user-facing asset tag (distinct from Asset ID)",
    )
    category_id: int
    category_name: str | None = None
    purchase_date: DateType
    cost: Decimal
    location: str
    status: AssetStatus
    awaiting_employee_details: bool = False
    version: int
    created_at: datetime
    assignment_id: int
    assigned_on: DateType
    user_id: int
    user_name: str | None = None
    user_email: str | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("cost")
    def serialize_cost(self, value: Decimal) -> float:
        return round(float(value), 2)


class AssetHistoryResponse(BaseModel):
    asset: AssetResponse
    assignments: list[AssignmentResponse]
    maintenance_records: list[MaintenanceRecordResponse]
