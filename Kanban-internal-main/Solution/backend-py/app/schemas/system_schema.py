"""Health and dev-only operations."""

from typing import Literal

from pydantic import Field

from app.schemas.common_schema import CamelModel, RequestDateTime, RequestModel


class Health(CamelModel):
    status: Literal["ok", "degraded"]
    db: Literal["ok", "down"]
    version: str | None = Field(default=None, description="Omitted in production.")


class ClockOverrideRequest(RequestModel):
    now: RequestDateTime = Field(description="RFC 3339 instant to use as 'now'.")
