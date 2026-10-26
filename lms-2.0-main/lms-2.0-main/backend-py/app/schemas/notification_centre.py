from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.base import CamelOut


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    notification_id: int
    template_key: str
    subject: str
    body: str
    status: str
    read_at: datetime | None
    related_request_id: int | None
    created_at: datetime


class DigestPreferenceOut(CamelOut):
    """Node hand-builds { digestEnabled } — camelCase. See app/schemas/base.py."""

    digest_enabled: bool


class DigestPreferenceIn(BaseModel):
    digest_enabled: bool
