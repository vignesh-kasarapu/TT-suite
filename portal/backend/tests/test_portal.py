"""Portal behaviour: admission, dashboard data, card launch, global administration, gateway."""

import pytest
from sqlalchemy import text

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
    assert me["access"] == {"kanban": "admin", "lms": "admin", "expense": "admin", "ams": "admin"}
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
    assert body["user"]["access"] == {"kanban": "lead", "lms": "admin", "expense": "member", "ams": None}
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
    assert res.json()["user"]["access"] == {"kanban": None, "lms": "manager", "expense": "finance", "ams": None}
    res = await portal.patch(f"/api/admin/users/{uid}", json={"status": "inactive"})
    body = res.json()
    assert body["user"]["status"] == "inactive"
    assert body["user"]["access"] == {"kanban": None, "lms": None, "expense": None, "ams": None}
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
    assert set(body["services"]) == {"portal", "kanban", "lms", "expense", "ams"}


async def test_bulk_invite_reports_each_row(portal, fake_apps):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    await portal.post("/api/admin/users", json={"email": "old@tektalis.com", "access": {"lms": {"role": "employee"}}})
    fake_apps.refuse["expense"] = (409, "ROLE_CONFLICT")
    res = await portal.post("/api/admin/users/bulk", json={"people": [
        {"email": "A1@tektalis.com", "name": "A One", "access": {"lms": {"role": "manager"}, "kanban": {"role": "lead", "leadTeamIds": ["T2"]}}},
        {"email": "old@tektalis.com", "access": {"lms": {"role": "admin"}}},
        {"email": "a2@tektalis.com", "access": {"kanban": {"role": "lead"}}},
        {"email": "a3@tektalis.com", "access": {"expense": {"role": "finance"}, "lms": {"role": "employee"}}},
    ]})
    assert res.status_code == 200, res.text
    rows = res.json()["results"]
    assert [r["email"] for r in rows] == ["a1@tektalis.com", "old@tektalis.com", "a2@tektalis.com", "a3@tektalis.com"]
    assert rows[0]["ok"] and rows[0]["user"]["access"] == {"kanban": "lead", "lms": "manager", "expense": None, "ams": None}
    assert not rows[1]["ok"] and rows[1]["code"] == "ALREADY_INVITED"
    assert not rows[2]["ok"] and rows[2]["code"] == "LEAD_NEEDS_TEAM"
    assert rows[3]["ok"] and rows[3]["errors"][0]["app"] == "expense" and rows[3]["user"]["access"]["lms"] == "employee"
    mail = [m["to"] for m in (await portal.get("/api/dev/mail")).json()["items"] if m["kind"] == "suite_invited"]
    assert sorted(m for m in mail if m.startswith("a")) == ["a1@tektalis.com", "a3@tektalis.com"]
    audit = (await portal.get("/api/admin/audit")).json()["items"]
    assert any(e["action"] == "bulk_invited" and e["detail"] == {"invited": 2, "refused": 2} for e in audit)


async def test_bulk_invite_is_global_admin_only(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    await portal.post("/api/admin/users", json={"email": "n@tektalis.com", "access": {"lms": {"role": "employee"}}})
    await sign_in(portal, "n@tektalis.com")
    res = await portal.post("/api/admin/users/bulk", json={"people": [{"email": "q@tektalis.com"}]})
    assert res.status_code == 403


async def seed_people(client, people):
    from app.services.admin_service import AdminService
    from app.services.apps_client import AppsClient
    from app.services.seed_file import SeedFile

    app = client.app
    async with app.state.sessionmaker() as db:
        svc = AdminService(db, app.state.settings, AppsClient(app.state.settings, app.state.http))
        return await svc.seed_people(SeedFile.model_validate({"people": people}).people)


async def test_seed_file_fills_missing_and_never_overwrites(portal, fake_apps):
    people = [
        {"email": "Seed.Lead@tektalis.com", "name": "Seed Lead",
         "access": {"lms": "manager", "kanban": {"role": "lead", "teams": ["web"]}}},
        {"email": "seed.ghost@tektalis.com", "access": {"kanban": {"role": "lead", "teams": ["Nope"]}, "expense": "member"}},
        {"email": "seed.boss@tektalis.com", "globalAdmin": True, "access": {"expense": "admin"}},
    ]
    assert await seed_people(portal, people) == []
    lead_call = [c for c in fake_apps.calls if c[1] == "/internal/provision" and c[2]["email"] == "seed.lead@tektalis.com" and c[0] == "kanban"]
    assert lead_call[0][2]["kanban_lead_team_ids"] == ["T2"]
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    users = {u["email"]: u for u in (await portal.get("/api/admin/users")).json()["items"]}
    assert users["seed.lead@tektalis.com"]["access"] == {"kanban": "lead", "lms": "manager", "expense": None, "ams": None}
    assert users["seed.lead@tektalis.com"]["status"] == "invited" and users["seed.lead@tektalis.com"]["name"] == "Seed Lead"
    assert users["seed.ghost@tektalis.com"]["access"] == {"kanban": None, "lms": None, "expense": "member", "ams": None}  # unknown team: Kanban skipped
    assert users["seed.boss@tektalis.com"]["isGlobalAdmin"] is True
    mail = (await portal.get("/api/dev/mail")).json()["items"]
    assert not [m for m in mail if m["to"].startswith("seed.")]  # seeding sends no invitations

    # an admin changes a seeded role; the next boot leaves it alone
    uid = users["seed.lead@tektalis.com"]["id"]
    await portal.put(f"/api/admin/users/{uid}/access", json={"lms": {"role": "employee"}})
    calls = len(fake_apps.calls)
    assert await seed_people(portal, people) == []
    after = {u["email"]: u for u in (await portal.get("/api/admin/users")).json()["items"]}
    assert after["seed.lead@tektalis.com"]["access"]["lms"] == "employee"
    assert not [c for c in fake_apps.calls[calls:] if c[1] == "/internal/provision"]


async def test_seed_file_waits_for_an_app_that_is_down(portal, fake_apps):
    fake_apps.down.add("lms")
    people = [{"email": "seed.wait@tektalis.com", "access": {"lms": "employee", "expense": "member"}}]
    waiting = await seed_people(portal, people)
    assert [p.email for p in waiting] == ["seed.wait@tektalis.com"]
    fake_apps.down.clear()
    assert await seed_people(portal, waiting) == []


async def test_invite_with_an_asset_management_role(portal, fake_apps):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    res = await portal.post("/api/admin/users", json={"email": "assets@tektalis.com", "access": {"ams": {"role": "manager"}}})
    assert res.status_code == 201, res.text
    assert res.json()["user"]["access"]["ams"] == "manager"
    call = [c for c in fake_apps.calls if c[0] == "ams" and c[1] == "/internal/provision"][-1]
    assert call[2]["role"] == "manager" and call[2]["source"] == "global"
    bad = await portal.post("/api/admin/users", json={"email": "assets2@tektalis.com", "access": {"ams": {"role": "lead"}}})
    assert bad.status_code == 422 and bad.json()["code"] == "UNKNOWN_ROLE"
    await sign_in(portal, "assets@tektalis.com")
    assert (await portal.get("/api/launch/ams")).headers["location"] == "/ams/"


async def test_microsoft_sign_in_unavailable_is_a_plain_message(portal):
    import httpx as _httpx

    class Down:
        async def authorize_url(self, **_):
            raise _httpx.ConnectError("no route to login.microsoftonline.com")

    portal.app.state.entra = Down()  # type: ignore[attr-defined]
    res = await portal.get("/api/auth/oidc/start?returnTo=/")
    assert res.status_code == 302 and res.headers["location"] == "/login?error=OIDC_UNAVAILABLE"


async def test_two_devices_and_signing_out_of_all_of_them(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    first = dict(portal.cookies)
    portal.cookies.clear()
    res = await portal.post("/api/auth/dev/sign-in", json={"email": ADMIN}, headers={"user-agent": "Phone browser"})
    assert res.status_code == 204
    second = dict(portal.cookies)
    devices = (await portal.get("/api/me/sessions")).json()["items"]
    assert len(devices) == 2 and sum(d["current"] for d in devices) == 1
    assert any(d["userAgent"] == "Phone browser" and d["current"] for d in devices)

    # this device only: the other one stays signed in
    res = await portal.post("/api/auth/logout", json={})
    assert res.json() == {"signedOut": 1}
    portal.cookies.clear()
    portal.cookies.update(first)
    assert (await portal.get("/api/me")).status_code == 200

    # everywhere: every device is out, and the inbox says so on the next sign-in
    res = await portal.post("/api/auth/logout", json={"everywhere": True})
    assert res.json() == {"signedOut": 1}
    for jar in (first, second):
        portal.cookies.clear()
        portal.cookies.update(jar)
        assert (await portal.get("/api/me")).status_code == 401
    await sign_in(portal, ADMIN)
    titles = [m["title"] for m in (await portal.get("/api/me/inbox")).json()["items"]]
    assert any("signed out of all devices" in t for t in titles)


async def test_role_request_is_approved_in_the_inbox_and_applied_in_the_app(portal, fake_apps):
    from suite_core import inbox

    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    await portal.post("/api/admin/users", json={"email": "lead.asker@tektalis.com", "access": {"lms": {"role": "admin"}}})
    await portal.post("/api/admin/users", json={"email": "worker@tektalis.com", "access": {"lms": {"role": "employee"}}})
    app = portal.app  # type: ignore[attr-defined]
    async with app.state.sessionmaker() as db:  # what an app does from its user management
        asker = (await db.execute(text("SELECT id FROM app.users WHERE email = 'lead.asker@tektalis.com'"))).scalar_one()
        await inbox.arequest_role_change(db, app="lms", email="worker@tektalis.com", role="manager",
                                         requested_by=asker, note="runs the night shift")
        await db.commit()

    me = (await portal.get("/api/me")).json()
    assert me["unreadCount"] >= 1
    requests = (await portal.get("/api/admin/role-requests")).json()["items"]
    req = next(r for r in requests if r["email"] == "worker@tektalis.com")
    assert req["status"] == "pending" and req["role"] == "manager" and req["note"] == "runs the night shift"

    res = await portal.post(f"/api/admin/role-requests/{req['id']}/approve", json={"note": "ok"})
    assert res.status_code == 200 and res.json()["status"] == "approved"
    users = {u["email"]: u for u in (await portal.get("/api/admin/users")).json()["items"]}
    assert users["worker@tektalis.com"]["access"]["lms"] == "manager"
    call = [c for c in fake_apps.calls if c[0] == "lms" and c[2].get("email") == "worker@tektalis.com"][-1]
    assert call[2]["role"] == "manager" and call[2]["source"] == "global"
    again = await portal.post(f"/api/admin/role-requests/{req['id']}/decline", json={})
    assert again.status_code == 409

    await sign_in(portal, "lead.asker@tektalis.com")
    titles = [m["title"] for m in (await portal.get("/api/me/inbox")).json()["items"]]
    assert any(t.startswith("Approved: ") and "Manager in Leave (LMS)" in t for t in titles)
    assert (await portal.post("/api/me/inbox/read", json={})).status_code == 204
    assert (await portal.get("/api/me")).json()["unreadCount"] == 0
    assert (await portal.get("/api/admin/role-requests")).status_code == 403  # only global admins decide


async def test_a_refused_approval_keeps_the_request_open(portal, fake_apps):
    from suite_core import inbox

    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    await portal.post("/api/admin/users", json={"email": "keeper@tektalis.com", "access": {"expense": {"role": "member"}}})
    app = portal.app  # type: ignore[attr-defined]
    async with app.state.sessionmaker() as db:
        await inbox.arequest_role_change(db, app="expense", email="keeper@tektalis.com", role="finance", requested_by=None)
        await db.commit()
    req = next(r for r in (await portal.get("/api/admin/role-requests")).json()["items"] if r["email"] == "keeper@tektalis.com")
    fake_apps.refuse["expense"] = (409, "ROLE_CONFLICT")
    res = await portal.post(f"/api/admin/role-requests/{req['id']}/approve", json={})
    assert res.status_code == 409 and res.json()["code"] == "ROLE_CONFLICT"
    still = next(r for r in (await portal.get("/api/admin/role-requests")).json()["items"] if r["id"] == req["id"])
    assert still["status"] == "pending"


async def test_request_access_lands_in_the_global_admins_inbox(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    await portal.post("/api/admin/users", json={"email": "curious@tektalis.com", "access": {"kanban": {"role": "member"}}})
    await sign_in(portal, "curious@tektalis.com")
    assert (await portal.post("/api/me/request-access", json={"app": "ams", "message": "need a laptop"})).status_code == 204
    await sign_in(portal, ADMIN)
    req = next(r for r in (await portal.get("/api/admin/role-requests")).json()["items"] if r["email"] == "curious@tektalis.com")
    assert req["app"] == "ams" and req["role"] == "employee" and req["note"] == "need a laptop"


async def test_the_profile_name_is_edited_in_the_portal(portal):
    await seed_admin(portal)
    await sign_in(portal, ADMIN)
    res = await portal.put("/api/me/profile", json={"name": "  Vignesh   Kasarapu "})
    assert res.status_code == 200 and res.json()["name"] == "Vignesh Kasarapu"
    assert (await portal.put("/api/me/profile", json={"name": "   "})).status_code == 422
