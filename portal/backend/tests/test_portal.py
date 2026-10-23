"""Portal behaviour: admission, dashboard data, card launch, global administration, gateway."""

import pytest

from tests.conftest import ADMIN, seed_admin, sign_in

pytestmark = pytest.mark.anyio


async def test_only_invited_people_get_in(portal):
    res = await portal.post("/api/auth/dev/sign-in", json={"email": "stranger@tektalis.com"})
    assert res.status_code == 403 and res.json()["code"] == "NOT_ADMITTED"
    assert (await portal.get("/api/me")).status_code == 401


async def test_seeded_global_admin_has_admin_everywhere(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    me = (await portal.get("/api/me")).json()
    assert me["isGlobalAdmin"] is True
    assert me["access"] == {"kanban": "admin", "lms": "admin", "expense": "admin"}
    assert me["preferences"] == {"preset": "linen", "mode": "system"}


async def test_invite_grants_roles_in_each_app_and_sends_one_mail(portal, fake_apps):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    res = await portal.post("/api/admin/users", json={
        "email": "X@Tektalis.com", "name": "X Person",
        "access": {"lms": {"role": "admin"}, "kanban": {"role": "lead", "leadTeamIds": ["T1"]}, "expense": {"role": "member"}},
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["errors"] == []
    assert body["user"]["access"] == {"kanban": "lead", "lms": "admin", "expense": "member"}
    kanban_call = [c for c in fake_apps.calls if c[0] == "kanban" and c[1] == "/internal/provision"][-1]
    assert kanban_call[2]["kanban_lead_team_ids"] == ["T1"] and kanban_call[2]["source"] == "global"
    mail = (await portal.get("/api/dev/mail")).json()["items"]
    assert [m["kind"] for m in mail if m["to"] == "x@tektalis.com"] == ["suite_invited"]
    # the invited person signs in and sees three cards with their roles
    await sign_in(portal, "x@tektalis.com")
    assert (await portal.get("/api/me")).json()["access"]["lms"] == "admin"


async def test_kanban_lead_needs_a_team(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    res = await portal.post("/api/admin/users", json={"email": "y@tektalis.com", "access": {"kanban": {"role": "lead"}}})
    assert res.status_code == 422 and res.json()["code"] == "LEAD_NEEDS_TEAM"


async def test_app_refusal_is_reported_and_other_apps_still_apply(portal, fake_apps):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    fake_apps.refuse["lms"] = (409, "LAST_HR_ADMIN")
    res = await portal.post("/api/admin/users", json={
        "email": "z@tektalis.com", "access": {"lms": {"role": "employee"}, "expense": {"role": "finance"}},
    })
    body = res.json()
    assert body["errors"] == [{"app": "lms", "code": "LAST_HR_ADMIN", "detail": "Leave (LMS): lms says no"}]
    assert body["user"]["access"]["expense"] == "finance" and body["user"]["access"]["lms"] is None


async def test_card_launch_authorizes_then_redirects(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    await portal.post("/api/admin/users", json={"email": "k@tektalis.com", "access": {"kanban": {"role": "member"}}})
    await sign_in(portal, "k@tektalis.com")
    ok = await portal.get("/api/launch/kanban")
    assert ok.status_code == 302 and ok.headers["location"] == "/kanban/"
    denied = await portal.get("/api/launch/lms")
    assert denied.status_code == 302 and denied.headers["location"] == "/?denied=lms"
    portal.cookies.clear()
    anon = await portal.get("/api/launch/kanban")
    assert anon.headers["location"] == "/login?returnTo=/api/launch/kanban"


async def test_launch_when_app_down(portal, fake_apps):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    fake_apps.down.add("expense")
    res = await portal.get("/api/launch/expense")
    assert res.headers["location"] == "/?unavailable=expense"


async def test_change_access_and_deactivate(portal, fake_apps):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    uid = (await portal.post("/api/admin/users", json={"email": "d@tektalis.com", "access": {"expense": {"role": "member"}}})).json()["user"]["id"]
    res = await portal.put(f"/api/admin/users/{uid}/access", json={"expense": {"role": "finance"}, "lms": {"role": "manager"}})
    assert res.json()["user"]["access"] == {"kanban": None, "lms": "manager", "expense": "finance"}
    res = await portal.patch(f"/api/admin/users/{uid}", json={"status": "inactive"})
    body = res.json()
    assert body["user"]["status"] == "inactive"
    assert body["user"]["access"] == {"kanban": None, "lms": None, "expense": None}
    assert (await portal.post("/api/auth/dev/sign-in", json={"email": "d@tektalis.com"})).status_code == 403


async def test_admin_guards(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    me = (await portal.get("/api/me")).json()
    res = await portal.patch(f"/api/admin/users/{me['id']}", json={"status": "inactive"})
    assert res.status_code == 409 and res.json()["code"] == "SELF"
    await portal.post("/api/admin/users", json={"email": "m@tektalis.com", "access": {"lms": {"role": "employee"}}})
    await sign_in(portal, "m@tektalis.com")
    assert (await portal.get("/api/admin/users")).status_code == 403


async def test_csrf_header_required(portal):
    await seed_admin(portal)
    res = await portal.post("/api/auth/dev/sign-in", json={"email": ADMIN}, headers={"x-requested-with": ""})
    assert res.status_code == 403 and res.json()["code"] == "CSRF_HEADER_MISSING"


async def test_preferences_round_trip(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    assert (await portal.put("/api/me/preferences", json={"preset": "harbour", "mode": "dark"})).status_code == 200
    assert (await portal.get("/api/me")).json()["preferences"] == {"preset": "harbour", "mode": "dark"}
    assert (await portal.put("/api/me/preferences", json={"preset": "neon", "mode": "dark"})).status_code == 422


async def test_request_access_mails_global_admins(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    await portal.post("/api/admin/users", json={"email": "r@tektalis.com", "access": {"kanban": {"role": "member"}}})
    await sign_in(portal, "r@tektalis.com")
    assert (await portal.post("/api/me/request-access", json={"app": "lms", "message": "need leave"})).status_code == 204
    mail = (await portal.get("/api/dev/mail")).json()["items"]
    assert any(m["kind"] == "request_access" and m["to"] == ADMIN for m in mail)


async def test_gateway_static_and_proxy(portal, fake_apps):
    assert (await portal.get("/")).text == "<html>portal</html>"
    assert (await portal.get("/admin/users")).text == "<html>portal</html>"  # client route
    assert (await portal.get("/kanban/board/1")).text == "<html>kanban</html>"
    assert (await portal.get("/kanban/assets/a.js")).headers["cache-control"].startswith("public")
    assert (await portal.get("/kanban/assets/missing.js")).status_code == 404
    assert "root:" not in (await portal.get("/kanban/..%2F..%2F..%2Fetc%2Fpasswd")).text
    # /<app>/api/* is proxied to the app with the prefix stripped
    res = await portal.get("/lms/api/health")
    assert res.status_code == 200 and res.json() == {"status": "ok"}
    assert (await portal.get("/api/nope")).status_code == 404
    # /internal is not reachable through the gateway (it lands on the SPA, never the app)
    assert (await portal.post("/lms/internal/provision", json={})).status_code == 405


async def test_health_reports_every_service(portal):
    body = (await portal.get("/api/health")).json()
    assert body["database"] == "ok"
    assert set(body["services"]) == {"portal", "kanban", "lms", "expense"}
