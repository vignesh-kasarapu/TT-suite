from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.common.enums import OldAssetAction, ReplacementStatus


class ReplacementRequestCreate(BaseModel):
    asset_id: int | None = Field(default=None, ge=1, description="Held asset ID to replace")
    assetId: int | None = Field(default=None, ge=1, description="CamelCase alias for asset_id")
    reason: str = Field(..., min_length=1, max_length=2000, description="Reason for replacement")
    old_asset_action: OldAssetAction | None = Field(
        default=None,
        description="What happens to the old asset: REPAIR or RETIRE",
    )
    oldAssetAction: OldAssetAction | None = Field(
        default=None,
        description="CamelCase alias for old_asset_action",
    )
    temporary: bool = Field(
        default=False,
        description="Whether the replacement is temporary until repair completes",
    )

    @field_validator("reason")
    @classmethod
    def validate_reason(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Replacement reason cannot be blank")
        return cleaned

    @model_validator(mode="after")
    def normalize_fields(self) -> "ReplacementRequestCreate":
        resolved_asset_id = self.asset_id if self.asset_id is not None else self.assetId
        if resolved_asset_id is None:
            raise ValueError("asset_id is required")
        self.asset_id = resolved_asset_id

        resolved_action = (
            self.old_asset_action
            if self.old_asset_action is not None
            else self.oldAssetAction
        )
        if resolved_action is None:
            raise ValueError("old_asset_action (REPAIR or RETIRE) is required")
        self.old_asset_action = resolved_action

        if self.temporary and self.old_asset_action == OldAssetAction.RETIRE:
            raise ValueError(
                "Temporary replacement requests require old_asset_action to be REPAIR"
            )
        return self


class ApproveReplacementRequest(BaseModel):
    replacement_asset_id: int | None = Field(
        default=None,
        ge=1,
        description="AVAILABLE replacement asset ID",
    )
    replacementAssetId: int | None = Field(
        default=None,
        ge=1,
        description="CamelCase alias for replacement_asset_id",
    )
    comment: str | None = Field(default=None, max_length=2000)
    decision_comment: str | None = Field(default=None, max_length=2000)
    decisionComment: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def normalize_fields(self) -> "ApproveReplacementRequest":
        resolved_id = (
            self.replacement_asset_id
            if self.replacement_asset_id is not None
            else self.replacementAssetId
        )
        if resolved_id is None:
            raise ValueError("replacement_asset_id (or replacementAssetId) is required")
        self.replacement_asset_id = resolved_id

        raw_comment = self.comment or self.decision_comment or self.decisionComment
        self.comment = raw_comment.strip() if raw_comment and raw_comment.strip() else None
        return self


class RejectReplacementRequest(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)
    decision_comment: str | None = Field(default=None, max_length=2000)
    decisionComment: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def normalize_comment(self) -> "RejectReplacementRequest":
        raw_comment = self.comment or self.decision_comment or self.decisionComment
        if raw_comment is None or not raw_comment.strip():
            raise ValueError("A rejection comment is required")
        self.comment = raw_comment.strip()
        return self


class HoldReplacementRequest(BaseModel):
    comment: str | None = Field(
        default=None,
        max_length=2000,
        description="Optional note visible on the request (e.g. awaiting category stock)",
    )

    @model_validator(mode="after")
    def normalize_comment(self) -> "HoldReplacementRequest":
        if self.comment is not None:
            cleaned = self.comment.strip()
            self.comment = cleaned or None
        return self


class ReplacementRequestResponse(BaseModel):
    id: int
    asset_id: int
    asset_tag: str | None = None
    asset_name: str | None = None
    asset_category_id: int | None = None
    asset_category_name: str | None = None
    requested_by: int
    requester_name: str | None = None
    requester_email: str | None = None
    reason: str
    old_asset_action: OldAssetAction
    temporary: bool
    replacement_asset_id: int | None = None
    replacement_asset_tag: str | None = None
    replacement_asset_name: str | None = None
    status: ReplacementStatus
    decided_by: int | None = None
    decider_name: str | None = None
    decider_email: str | None = None
    decision_comment: str | None = None
    decided_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
