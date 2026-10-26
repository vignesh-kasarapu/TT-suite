"""Headers, CSRF, body cap, problem-JSON shapes, SPA fallback, log PII
(TC-005/006/010/011/012/013/015/022/036)."""

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter

from tests.conftest import AppFactory, assert_problem

TC005_CSP = (
    "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; "
    "form-action 'self'; style-src 'self' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com"
)
HEADER_SET = {
    "content-security-policy": TC005_CSP,
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
}


async def test_tc005_security_headers_dev_profile(make_api: AppFactory) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")
    page = await api.call("GET", "/")
    health = await api.call("GET", "/api/v1/health")
    for res in (page, health):
        for name, value in HEADER_SET.items():
            assert res.headers.get(name) == value, name
        assert "strict-transport-security" not in res.headers
    assert health.headers["cache-control"] == "no-store"
    assert page.status_code == 200


async def test_tc012_missing_csrf_header_is_refused_before_anything_else(
    make_api: AppFactory,
) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")
    res = await api.call("POST", "/api/v1/auth/sign-out", csrf=False)
    assert_problem(res, 403, "CSRF_HEADER_MISSING")


async def test_def009_refused_csrf_requests_still_count_against_the_rate_limit(
    make_api: AppFactory,
) -> None:
    api = await make_api("t_py_security_rl", APP_PROFILE="dev", RL_DEFAULT_IP="5/min")
    for _ in range(5):
        assert_problem(
            await api.call("POST", "/api/v1/auth/sign-out", csrf=False), 403, "CSRF_HEADER_MISSING"
        )
    assert_problem(await api.call("POST", "/api/v1/auth/sign-out", csrf=False), 429, "RATE_LIMITED")


async def test_tc011_oversized_body_is_413(make_api: AppFactory) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")
    big = json.dumps({"userId": "x" * (300 * 1024)})
    res = await api.call(
        "POST",
        "/api/v1/auth/dev/sign-in",
        content=big,
        headers={"content-type": "application/json"},
    )
    assert_problem(res, 413, "PAYLOAD_TOO_LARGE")


async def test_tc013_validation_lists_the_missing_field(make_api: AppFactory) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")
    res = await api.call("POST", "/api/v1/auth/dev/sign-in", json={"nope": 1})
    body = assert_problem(res, 422, "VALIDATION_FAILED")
    assert "userId" in [e.get("field") for e in body["errors"]]
    for e in body["errors"]:
        assert isinstance(e["code"], str) and isinstance(e["message"], str)


async def test_malformed_json_is_400_and_wrong_type_is_strict(make_api: AppFactory) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")
    res = await api.call(
        "POST",
        "/api/v1/auth/dev/sign-in",
        content="{",
        headers={"content-type": "application/json"},
    )
    assert_problem(res, 400, "BAD_REQUEST")
    typed = await api.call("POST", "/api/v1/auth/dev/sign-in", json={"userId": 12})
    assert_problem(typed, 422, "VALIDATION_FAILED")


async def test_tc010_unknown_api_route_and_wrong_method_are_404_problem(
    make_api: AppFactory,
) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")
    res = await api.call("GET", "/api/v1/nope")
    assert_problem(res, 404, "NOT_FOUND")
    assert res.text.strip().startswith("{")
    # POST on a GET-only route: no such route (not 405); also no trailing-slash redirect.
    assert_problem(await api.call("POST", "/api/v1/me/preferences"), 404, "NOT_FOUND")
    assert_problem(await api.call("GET", "/api/v1/health/"), 404, "NOT_FOUND")


async def test_tc036_spa_fallback_never_serves_html_for_api(make_api: AppFactory) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")
    spa = await api.call("GET", "/some/spa/route")
    assert spa.status_code == 200
    assert spa.headers["content-type"].startswith("text/html")
    assert '<div id="root">' in spa.text
    asset = await api.call("GET", "/assets/app-fixture.js")
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    traversal = await api.call("GET", "/assets/../../conftest.py")
    assert "fixtures" not in traversal.text
    res = await api.call("GET", "/api/v1/nope")
    assert res.status_code == 404
    assert res.headers["content-type"].startswith("application/problem+json")


async def test_tc022_no_pii_from_bodies_in_logs_and_ical_token_redacted(
    make_api: AppFactory,
) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")
    api.logs.truncate(0)
    await api.call(
        "POST", "/api/v1/me/preferences", json={"accent": "pii.person@example.test ReasonTextXYZ"}
    )
    await api.call("GET", "/api/v1/feeds/ical/ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")
    captured = api.logs.getvalue()
    assert "pii.person" not in captured
    assert "ReasonTextXYZ" not in captured
    assert "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" not in captured
    assert "/feeds/ical/[redacted]" in captured


async def test_tc015_unknown_error_is_500_without_internals(make_api: AppFactory) -> None:
    api = await make_api("t_py_security_500")
    boom = APIRouter()

    @boom.get("/api/v1/__test/throw")
    async def throw() -> None:
        raise RuntimeError("boom from C:/secret/path/file.py")

    api.app.router.routes.insert(0, boom.routes[0])
    res = await api.call("GET", "/api/v1/__test/throw")
    body = assert_problem(res, 500, "INTERNAL")
    assert "stack" not in body and "detail" not in body
    assert "secret/path" not in res.text
    assert res.headers["x-content-type-options"] == "nosniff"


async def test_tc006_hsts_outside_dev(make_api: AppFactory) -> None:
    api = await make_api("t_py_security_hsts", APP_PROFILE="test")
    res = await api.call("GET", "/api/v1/health")
    assert "max-age=15552000" in res.headers["strict-transport-security"]


async def test_oversized_body_without_content_length_is_413(make_api: AppFactory) -> None:
    api = await make_api("t_py_security", APP_PROFILE="dev")

    async def chunks() -> AsyncIterator[bytes]:
        yield b'{"userId":"' + b"x" * (300 * 1024) + b'"}'

    res = await api.client.post(
        "/api/v1/auth/dev/sign-in",
        content=chunks(),
        headers={"x-requested-with": "XHR", "content-type": "application/json"},
    )
    assert "content-length" not in res.request.headers
    assert_problem(res, 413, "PAYLOAD_TOO_LARGE")
