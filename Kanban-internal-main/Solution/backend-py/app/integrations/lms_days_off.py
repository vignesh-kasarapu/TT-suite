"""Leave and holidays, from LMS (SUITE-CONTRACT §3.2).

Somebody on approved leave should not be asked to account for eight hours that day, and
nobody should have to tell two applications the same thing. LMS owns leave and the holiday
calendar, so the time log asks it rather than keeping a second record.

The call is internal: same box, `x-internal-token`, never through the public gateway. It is
also non-essential — if LMS is down or slow the time log still works, it simply shows no days
off, which is what it did before this existed.
"""

from dataclasses import dataclass
from datetime import date

import httpx

from app.core.logging import get_logger

#: Short on purpose: the time page must not wait on another app.
TIMEOUT_SECONDS = 3.0
#: LMS refuses more than this many people in one call.
MAX_USERS = 500


@dataclass(frozen=True)
class LmsDayOff:
    suite_user_id: str
    date: date
    kind: str  # "leave" | "holiday"
    label: str
    portion: float  # 1.0 for a whole day, 0.5 for half


async def fetch(
    base_url: str, token: str, suite_user_ids: list[str], start: date, end: date
) -> list[LmsDayOff]:
    """The days these people are not working. Returns [] when LMS cannot be reached."""
    ids = [i for i in dict.fromkeys(suite_user_ids) if i]
    if not ids or not base_url or not token or end < start:
        return []

    rows: list[LmsDayOff] = []
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as http:
            for chunk in (ids[i : i + MAX_USERS] for i in range(0, len(ids), MAX_USERS)):
                res = await http.post(
                    f"{base_url.rstrip('/')}/internal/days-off",
                    headers={"x-internal-token": token},
                    json={
                        "suiteUserIds": chunk,
                        "start": start.isoformat(),
                        "end": end.isoformat(),
                    },
                )
                if res.status_code >= 400:
                    get_logger().warning(
                        "lms_days_off_refused", status=res.status_code, body=res.text[:200]
                    )
                    return []
                for row in res.json().get("days", []):
                    rows.append(
                        LmsDayOff(
                            suite_user_id=row["suiteUserId"],
                            date=date.fromisoformat(row["date"]),
                            kind=row["kind"],
                            label=row.get("label", ""),
                            portion=float(row.get("portion", 1.0)),
                        )
                    )
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        # Never fail a time page because another application is unavailable.
        get_logger().warning("lms_days_off_unavailable", error=str(exc))
        return []
    return rows
