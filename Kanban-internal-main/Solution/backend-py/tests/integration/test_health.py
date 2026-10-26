"""Health, rate limit, correlation id, dev clock (TC-002/003/004/014/033)."""

import json

from tests.conftest import AppFactory, assert_problem


async def test_tc002_healthy(make_api: AppFactory) -> None:
    api = await make_api("t_py_health")
    res = await api.call("GET", "/api/v1/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "db": "ok", "version": "dev"}


async def test_tc014_correlation_id_minted_echoed_and_logged(make_api: AppFactory) -> None:
    api = await make_api("t_py_health")
    minted = await api.call("GET", "/api/v1/health")
    assert minted.headers["x-correlation-id"]
    api.logs.truncate(0)
    api.logs.seek(0)
    echoed = await api.call("GET", "/api/v1/health", headers={"x-correlation-id": "abc-123"})
    assert echoed.headers["x-correlation-id"] == "abc-123"
    lines = [json.loads(x) for x in api.logs.getvalue().splitlines() if x.strip()]
    line = next(x for x in lines if x.get("route") == "GET /api/v1/health")
    assert line["correlationId"] == "abc-123" and line["status"] == 200
    assert isinstance(line["durationMs"], int)


async def test_tc033_clock_override_set_and_clear(make_api: AppFactory) -> None:
    api = await make_api("t_py_health")
    await api.set_clock("2026-06-15T04:30:00Z")
    clock = api.app.state.clock
    assert clock.now().isoformat() == "2026-06-15T04:30:00+00:00"
    assert clock.today("Asia/Kolkata") == "2026-06-15"
    res = await api.call("DELETE", "/api/v1/dev/clock")
    assert res.status_code == 204
    assert not clock.is_overridden()
    bad = await api.call("PUT", "/api/v1/dev/clock", json={"now": "2026-06-15T04:30:00"})
    assert_problem(bad, 422, "VALIDATION_FAILED")


async def test_tc004_health_rate_limit_with_retry_after(make_api: AppFactory) -> None:
    api = await make_api("t_py_health_rl", RL_HEALTH_IP="60/min")
    for i in range(60):
        assert (await api.call("GET", "/api/v1/health")).status_code == 200, i
    last = await api.call("GET", "/api/v1/health")
    assert_problem(last, 429, "RATE_LIMITED")
    assert int(last.headers["retry-after"]) > 0


async def test_tc003_degraded_when_the_database_is_down(make_api: AppFactory) -> None:
    api = await make_api(
        "t_py_health_down",
        DATABASE_URL="postgres://app_rw:dev@127.0.0.1:5499/nowhere",
    )
    res = await api.call("GET", "/api/v1/health")
    assert res.status_code == 503
    assert res.json() == {"status": "degraded", "db": "down", "version": "dev"}
