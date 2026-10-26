"""Preferences (FR-070, D-077, CR-19), display name and picture (D-064c)."""

import base64

from tests.conftest import Api, AppFactory, Session, assert_problem
from tests.fixtures import fixture_id

DEFAULTS = {
    "theme": "system",
    "accent": "linen",
    "notifyEmail": False,
    "primaryTeamId": None,
    "primaryProjectId": None,
    "orgOrder": "team_first",
    "inboxWindowDays": 30,
}


async def _member(make_api: AppFactory) -> tuple[Api, Session]:
    api = await make_api("t_py_me")
    api.seed()
    await api.set_clock("2026-06-15T04:30:00Z")
    return api, await api.sign_in("M1")


async def test_preferences_default_then_partial_patch(make_api: AppFactory) -> None:
    api, m1 = await _member(make_api)
    assert (await api.call("GET", "/api/v1/me/preferences", session=m1)).json() == DEFAULTS
    res = await api.call(
        "PATCH",
        "/api/v1/me/preferences",
        session=m1,
        json={"theme": "dark", "primaryTeamId": fixture_id("TEAM_PLATFORM")},
    )
    assert res.status_code == 200
    assert res.json() == {**DEFAULTS, "theme": "dark", "primaryTeamId": fixture_id("TEAM_PLATFORM")}
    cleared = await api.call(
        "PATCH", "/api/v1/me/preferences", session=m1, json={"primaryTeamId": None}
    )
    assert cleared.json()["primaryTeamId"] is None and cleared.json()["theme"] == "dark"


async def test_preferences_rules(make_api: AppFactory) -> None:
    api, m1 = await _member(make_api)
    call = api.call
    accent = await call("PATCH", "/api/v1/me/preferences", session=m1, json={"accent": "neon"})
    body = assert_problem(accent, 422, "VALIDATION_FAILED")
    assert body["errors"] == [
        {
            "field": "accent",
            "code": "ENUM",
            "message": "accent must be one of linen, harbour, graphite",
        }
    ]
    other_team = await call(
        "PATCH",
        "/api/v1/me/preferences",
        session=m1,
        json={"primaryTeamId": fixture_id("TEAM_WEB")},
    )
    assert (
        assert_problem(other_team, 422, "VALIDATION_FAILED")["errors"][0]["code"] == "NOT_A_MEMBER"
    )
    unknown_project = await call(
        "PATCH",
        "/api/v1/me/preferences",
        session=m1,
        json={"primaryProjectId": fixture_id("NO_SUCH_PROJECT")},
    )
    assert_problem(unknown_project, 422, "VALIDATION_FAILED")
    # null only where the contract allows it; strict types; range checks.
    for bad in (
        {"theme": None},
        {"notifyEmail": "true"},
        {"inboxWindowDays": 0},
        {"theme": "blue"},
    ):
        assert_problem(
            await call("PATCH", "/api/v1/me/preferences", session=m1, json=bad),
            422,
            "VALIDATION_FAILED",
        )


async def test_profile_name_override(make_api: AppFactory) -> None:
    api, m1 = await _member(make_api)
    call = api.call
    res = await call("PATCH", "/api/v1/me/profile", session=m1, json={"name": "  Meera K  "})
    assert res.status_code == 200
    assert res.json() == {
        "id": fixture_id("M1"),
        "name": "Meera K",
        "email": "m1@example.test",
        "role": "member",
        "photoUpdatedAt": None,
    }
    for bad in ({}, {"name": ""}, {"name": "x" * 121}):
        assert_problem(
            await call("PATCH", "/api/v1/me/profile", session=m1, json=bad),
            422,
            "VALIDATION_FAILED",
        )


async def test_photo_set_get_delete(make_api: AppFactory) -> None:
    api, m1 = await _member(make_api)
    call = api.call
    m2 = await api.sign_in("M2")
    data = b"\xff\xd8\xff\xe0 fake jpeg"
    url = f"data:image/jpeg;base64,{base64.b64encode(data).decode()}"
    put = await call("PUT", "/api/v1/me/photo", session=m1, json={"dataUrl": url})
    assert put.status_code == 200
    assert put.json()["photoUpdatedAt"] == "2026-06-15T04:30:00.000Z"
    got = await call("GET", f"/api/v1/users/{fixture_id('M1')}/photo", session=m2)
    assert got.status_code == 200 and got.content == data
    assert got.headers["content-type"] == "image/jpeg"
    assert got.headers["cache-control"] == "private, max-age=86400"
    assert got.headers["last-modified"] == "Mon, 15 Jun 2026 04:30:00 GMT"
    gif = await call(
        "PUT", "/api/v1/me/photo", session=m1, json={"dataUrl": "data:image/gif;base64,AA"}
    )
    assert_problem(gif, 422, "VALIDATION_FAILED")
    assert (await call("DELETE", "/api/v1/me/photo", session=m1)).status_code == 204
    assert_problem(
        await call("GET", f"/api/v1/users/{fixture_id('M1')}/photo", session=m2), 404, "NOT_FOUND"
    )
    assert_problem(
        await call("GET", "/api/v1/users/not-an-id/photo", session=m2), 422, "VALIDATION_FAILED"
    )
    assert_problem(
        await call("GET", f"/api/v1/users/{fixture_id('M1')}/photo"), 401, "UNAUTHENTICATED"
    )
