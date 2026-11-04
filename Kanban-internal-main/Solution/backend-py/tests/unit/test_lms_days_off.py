"""The LMS leave/holiday lookup behind the time log (SUITE-CONTRACT §3.2).

What matters here: the call is made the way LMS expects it, and the time log keeps working
when LMS does not answer — a day's hours must never depend on another application being up.
"""

from datetime import date

import httpx
import pytest

from app.integrations import lms_days_off

START, END = date(2026, 6, 15), date(2026, 6, 19)


def _transport(handler: object) -> None:
    pass


async def _fetch_with(monkeypatch: pytest.MonkeyPatch, handler: object, **kwargs: object) -> list:
    class FakeClient:
        def __init__(self, *_a: object, **_k: object) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_a: object) -> None:
            return None

        async def post(self, url: str, headers: dict, json: dict) -> httpx.Response:
            return handler(url, headers, json)  # type: ignore[operator]

    monkeypatch.setattr(lms_days_off.httpx, "AsyncClient", FakeClient)
    return await lms_days_off.fetch(
        kwargs.get("base_url", "http://lms"),  # type: ignore[arg-type]
        kwargs.get("token", "secret"),  # type: ignore[arg-type]
        kwargs.get("ids", ["suite-1", "suite-2"]),  # type: ignore[arg-type]
        START,
        END,
    )


async def test_it_asks_lms_and_reads_the_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def handler(url: str, headers: dict, json: dict) -> httpx.Response:
        seen.update({"url": url, "headers": headers, "json": json})
        return httpx.Response(
            200,
            json={
                "days": [
                    {
                        "suiteUserId": "suite-1", "date": "2026-06-19",
                        "kind": "leave", "label": "Annual Leave", "portion": 1.0,
                    },
                    {
                        "suiteUserId": "suite-2", "date": "2026-06-17",
                        "kind": "holiday", "label": "Founders Day", "portion": 1.0,
                    },
                ]
            },
            request=httpx.Request("POST", url),
        )

    rows = await _fetch_with(monkeypatch, handler)

    assert seen["url"] == "http://lms/internal/days-off"
    assert seen["headers"] == {"x-internal-token": "secret"}
    assert seen["json"] == {
        "suiteUserIds": ["suite-1", "suite-2"],
        "start": "2026-06-15",
        "end": "2026-06-19",
    }
    assert [(r.suite_user_id, r.date, r.kind, r.label) for r in rows] == [
        ("suite-1", date(2026, 6, 19), "leave", "Annual Leave"),
        ("suite-2", date(2026, 6, 17), "holiday", "Founders Day"),
    ]


async def test_half_a_day_comes_through(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(url: str, _headers: dict, _json: dict) -> httpx.Response:
        return httpx.Response(
            200,
            json={"days": [{"suiteUserId": "suite-1", "date": "2026-06-16",
                            "kind": "leave", "label": "Casual", "portion": 0.5}]},
            request=httpx.Request("POST", url),
        )

    rows = await _fetch_with(monkeypatch, handler)
    assert rows[0].portion == 0.5


async def test_an_unavailable_lms_means_no_days_off(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(url: str, _headers: dict, _json: dict) -> httpx.Response:
        raise httpx.ConnectError("refused", request=httpx.Request("POST", url))

    assert await _fetch_with(monkeypatch, handler) == []


async def test_a_refusal_means_no_days_off(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(url: str, _headers: dict, _json: dict) -> httpx.Response:
        return httpx.Response(401, json={"code": "BAD_INTERNAL_TOKEN"},
                              request=httpx.Request("POST", url))

    assert await _fetch_with(monkeypatch, handler) == []


@pytest.mark.parametrize(
    "base_url,token,ids",
    [("", "secret", ["suite-1"]), ("http://lms", "", ["suite-1"]), ("http://lms", "secret", [])],
)
async def test_nothing_is_asked_without_a_url_a_token_or_anybody_to_ask_about(
    monkeypatch: pytest.MonkeyPatch, base_url: str, token: str, ids: list[str]
) -> None:
    def handler(url: str, _headers: dict, _json: dict) -> httpx.Response:  # pragma: no cover
        raise AssertionError("LMS must not be called")

    assert await _fetch_with(monkeypatch, handler, base_url=base_url, token=token, ids=ids) == []
