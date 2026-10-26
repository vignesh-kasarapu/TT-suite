"""Identity: dev sign-in (a suite session), me, portal sign-out, expiry, dev mode off, boot seed.

TT Suite (SUITE-CONTRACT §3.1): the session is the portal's `app.session` row; signing out and
expiry are simulated by deleting or ageing that row, as the portal does."""

import psycopg

from app.core.database import UnitOfWork
from app.core.security import hash_session_id
from app.repositories.suite_repository import SuiteRepository
from app.repositories.user_repository import UserRepository
from app.services.system_service import SeedService
from tests.conftest import AppFactory, Session, app_url, assert_problem
from tests.fixtures import fixture_id


async def test_auth_config_and_dev_user_list(make_api: AppFactory) -> None:
    api = await make_api("t_py_identity", SESSION_HOURS="2")
    api.seed()
    cfg = await api.call("GET", "/api/v1/auth/config")
    assert cfg.status_code == 200 and cfg.json() == {"provider": "suite"}
    users = (await api.call("GET", "/api/v1/auth/dev/users")).json()["items"]
    ids = [u["id"] for u in users]
    assert fixture_id("M1") in ids and fixture_id("GONE") not in ids
    assert set(users[0]) == {"id", "name", "email", "role"}


async def test_no_session_is_401(make_api: AppFactory) -> None:
    api = await make_api("t_py_identity", SESSION_HOURS="2")
    assert_problem(await api.call("GET", "/api/v1/me"), 401, "UNAUTHENTICATED")


def _suite_sql(api_db: str, sql: str, s: Session) -> None:
    """Run `sql` on the session's `app.session` row (`:sid` = the stored hash)."""
    token = s.cookie.split("=", 1)[1]
    with psycopg.connect(app_url(api_db)) as c:
        c.execute(sql, {"sid": hash_session_id(token)})


async def test_sign_in_me_and_portal_sign_out(make_api: AppFactory) -> None:
    api = await make_api("t_py_identity", SESSION_HOURS="2")
    api.seed()
    s = await api.sign_in("ADMIN")
    me = await api.call("GET", "/api/v1/me", session=s)
    assert me.status_code == 200
    body = me.json()
    assert body["user"]["id"] == fixture_id("ADMIN") and body["user"]["role"] == "admin"
    assert body["user"]["photoUpdatedAt"] is None
    assert "status" not in body["user"]  # listUsers only
    assert body["teams"] == [] and body["leadTeamIds"] == [] and body["inboxUnread"] == 0
    assert body["sessionExpiresAt"].endswith("Z")
    # Kanban has no sign-out of its own any more (the portal's POST /api/auth/logout).
    assert_problem(await api.call("POST", "/api/v1/auth/sign-out", session=s), 404, "NOT_FOUND")
    _suite_sql(api.db, "DELETE FROM app.session WHERE id = %(sid)s", s)
    out = await api.call("GET", "/api/v1/me", session=s)
    assert_problem(out, 401, "UNAUTHENTICATED")
    assert "tt_session=;" in out.headers["set-cookie"]


async def test_me_lists_teams_and_lead_teams(make_api: AppFactory) -> None:
    api = await make_api("t_py_identity", SESSION_HOURS="2")
    api.seed()
    with psycopg.connect(app_url(api.db)) as c:
        c.execute("UPDATE team_member SET is_lead = true WHERE user_id = %s", (fixture_id("M1"),))
    s = await api.sign_in("M1")
    body = (await api.call("GET", "/api/v1/me", session=s)).json()
    assert body["teams"] == [{"id": fixture_id("TEAM_PLATFORM"), "name": "Platform"}]
    assert body["leadTeamIds"] == [fixture_id("TEAM_PLATFORM")]


async def test_unknown_or_inactive_user_is_404(make_api: AppFactory) -> None:
    api = await make_api("t_py_identity", SESSION_HOURS="2")
    api.seed()
    for user_id in ("01ARZ3NDEKTSV4RRFFQ69G5FAV", fixture_id("GONE")):
        res = await api.call("POST", "/api/v1/auth/dev/sign-in", json={"userId": user_id})
        assert_problem(res, 404, "NOT_FOUND")


async def test_session_expires_after_session_hours_and_cookie_is_cleared(
    make_api: AppFactory,
) -> None:
    """The suite session's `expires_at` (database clock) is the authority: the dev sign-in sets
    it SESSION_HOURS ahead; once past, the cookie is refused and cleared."""
    api = await make_api("t_py_identity", SESSION_HOURS="2")
    api.seed()
    s = await api.sign_in("M1")
    me = await api.call("GET", "/api/v1/me", session=s)
    assert me.status_code == 200
    with psycopg.connect(app_url(api.db)) as c:
        hours = c.execute(
            "SELECT round(extract(epoch FROM expires_at - created_at) / 3600) FROM app.session"
            " WHERE user_id = (SELECT suite_user_id FROM app_user WHERE id = %s)",
            (fixture_id("M1"),),
        ).fetchone()
    assert hours is not None and int(hours[0]) == 2
    _suite_sql(
        api.db,
        "UPDATE app.session SET expires_at = now() - interval '1 minute' WHERE id = %(sid)s",
        s,
    )
    gone = await api.call("GET", "/api/v1/me", session=s)
    assert_problem(gone, 401, "UNAUTHENTICATED")
    assert "tt_session=;" in gone.headers["set-cookie"]


async def test_dev_mode_off_unmounts_dev_sign_in_only(make_api: AppFactory) -> None:
    api = await make_api("t_py_identity_off", AUTH_DEV_MODE="false")
    res = await api.call("POST", "/api/v1/auth/dev/sign-in", json={"userId": fixture_id("M1")})
    assert_problem(res, 404, "NOT_FOUND")
    clock = await api.call("PUT", "/api/v1/dev/clock", json={"now": "2026-06-15T04:30:00Z"})
    assert clock.status_code == 204


async def test_prod_never_mounts_dev_operations(make_api: AppFactory) -> None:
    api = await make_api(
        "t_py_identity_prod",
        APP_PROFILE="prod",
        AUTH_DEV_MODE="false",
        MAIL_PROVIDER="graph",
    )
    for method, url in (
        ("PUT", "/api/v1/dev/clock"),
        ("GET", "/api/v1/auth/dev/users"),
        ("POST", "/api/v1/auth/dev/sign-in"),
    ):
        assert_problem(await api.call(method, url, json={}), 404, "NOT_FOUND")
    assert (await api.call("GET", "/api/openapi.json")).status_code == 404


async def test_boot_seed_creates_then_promotes_the_admin(make_api: AppFactory) -> None:
    api = await make_api("t_py_identity_seed")
    maker = api.app.state.sessionmaker
    clock = api.app.state.clock
    async with maker() as s1:
        assert await SeedService(
            UnitOfWork(s1), UserRepository(s1), SuiteRepository(s1), clock
        ).seed_admin(" Boss@Example.Test ")
    async with maker() as s2:
        assert not await SeedService(
            UnitOfWork(s2), UserRepository(s2), SuiteRepository(s2), clock
        ).seed_admin("boss@example.test")
    with psycopg.connect(app_url(api.db)) as c:
        row = c.execute(
            "SELECT name, role, status FROM app_user WHERE email = 'boss@example.test'"
        ).fetchone()
        assert row == ("boss", "admin", "active")
        c.execute("UPDATE app_user SET role = 'member' WHERE email = 'boss@example.test'")
    async with maker() as s3:
        await SeedService(
            UnitOfWork(s3), UserRepository(s3), SuiteRepository(s3), clock
        ).seed_admin("boss@example.test")
    with psycopg.connect(app_url(api.db)) as c:
        role = c.execute("SELECT role FROM app_user WHERE email = 'boss@example.test'").fetchone()
        assert role == ("admin",)
        # Mirrored to the suite (SUITE-CONTRACT §3.3), linked by suite_user_id.
        access = c.execute(
            "SELECT a.role, a.source FROM app.app_access a JOIN app_user u"
            " ON u.suite_user_id = a.user_id WHERE u.email = 'boss@example.test'"
            " AND a.app = 'kanban'"
        ).fetchall()
        assert access == [("admin", "app")]
