"""Wire formats for instants and dates (API contract: RFC 3339 UTC with milliseconds, and
calendar dates as YYYY-MM-DD)."""

from datetime import UTC, date, datetime
from email.utils import format_datetime
from typing import Annotated

from pydantic import PlainSerializer


def iso_utc(dt: datetime) -> str:
    """2026-06-15T04:30:00.000Z - the exact form clients and stored data already use."""
    u = dt.astimezone(UTC)
    return u.strftime("%Y-%m-%dT%H:%M:%S.") + f"{u.microsecond // 1000:03d}Z"


def http_date(dt: datetime) -> str:
    """Last-Modified style: Mon, 15 Jun 2026 04:30:00 GMT."""
    return format_datetime(dt.astimezone(UTC), usegmt=True)


def iso_date(d: date) -> str:
    return d.isoformat()


# Response field types: serialise as above while the OpenAPI schema still says date-time / date.
UtcDateTime = Annotated[datetime, PlainSerializer(iso_utc, return_type=str, when_used="json")]
CalendarDate = Annotated[date, PlainSerializer(iso_date, return_type=str, when_used="json")]
