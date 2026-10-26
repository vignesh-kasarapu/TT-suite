"""Clock: the system clock in prod, a settable one in dev/test (APP_FAKE_NOW, PUT /dev/clock).

Times are truncated to milliseconds: that is the precision the API returns (RFC 3339 with
`.sssZ`) and the precision stored rows have always had, so comparisons stay exact.
"""

from datetime import UTC, datetime
from zoneinfo import ZoneInfo


def _ms(dt: datetime) -> datetime:
    return dt.replace(microsecond=dt.microsecond // 1000 * 1000)


def parse_instant(value: str) -> datetime:
    """RFC 3339 -> aware UTC datetime (a naive value is read as UTC)."""
    dt = datetime.fromisoformat(value)
    return _ms((dt if dt.tzinfo else dt.replace(tzinfo=UTC)).astimezone(UTC))


class Clock:
    def now(self) -> datetime:
        return _ms(datetime.now(UTC))

    def today(self, org_tz: str) -> str:
        """Calendar date (YYYY-MM-DD) in the org time zone."""
        return self.now().astimezone(ZoneInfo(org_tz)).date().isoformat()


class SystemClock(Clock):
    pass


class FakeClock(Clock):
    """Fixed "now" until cleared; `clear()` returns to the system clock."""

    def __init__(self, initial: str | None = None) -> None:
        self._fixed = parse_instant(initial) if initial else None

    def set(self, value: datetime) -> None:
        self._fixed = _ms(value.astimezone(UTC))

    def clear(self) -> None:
        self._fixed = None

    def is_overridden(self) -> bool:
        return self._fixed is not None

    def now(self) -> datetime:
        return self._fixed if self._fixed is not None else super().now()
