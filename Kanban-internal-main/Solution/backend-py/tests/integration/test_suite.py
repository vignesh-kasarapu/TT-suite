"""TT Suite single sign-on (SUITE-CONTRACT §3): the suite cookie resolves the actor, no Kanban
access is 403 NO_APP_ACCESS, the portal's /internal/* calls (provision, authorize, teams), the
self-heal, and the mirror of Kanban's own admin changes into `app.app_access`.

The portal's side (a person, their access row, a session) is written with SQL, as the portal
would; the sign-in cookie it would set is `tt_session`.
"""

from typing import Any

import psycopg
from suite_core.cookies import hash_session_id, new_session_token
from suite_core.ulid import ulid

from tests.conftest import Api, AppFactory, Session, app_url, assert_problem
from tests.fixtures import email_of, fixture_id

TOKEN = "internal-test-token"
INTERNAL = {"x-internal-token": TOKEN}
PLATFORM = fixture_id("TEAM_PLATFORM")
WEB = fixture_id("TEAM_WEB")


async def _api(make_api: AppFactory, db: str, **env: str) -> Api:
    api = await make_api(db, INTERNAL_TOKEN=TOKEN, **env)
    api.seed()
    return api


def _sql(api: Api, query: str, *args: Any) -> list[tuple[Any, ...]]:
    with psycopg.connect(app_url(api.db)) as c:
        cur = c.execute(query, args)
        return cur.fetchall() if cur.description else []


def _portal_sign_in(
    api: Api,
    email: str,
    *,
    role: str | None,
    name: str = "",
    entra_oid: str | None = None,
) -> tuple[Session, str]:
    """What the portal does: the person (active), their Kanban access, a session + cookie."""
    token = new_session_token()
    with psycopg.connect(app_url(api.db)) as c:
        row = c.execute("SELECT id FROM app.users WHERE email = %s", (email,)).fetchone()
        uid = row[0] if row else ulid()
        if row is not None:  # the portal activates an invited person at their first sign-in
            c.execute(
                "UPDATE app.users SET status = 'active', entra_oid = COALESCE(entra_oid, %s)"
                " WHERE id = %s",
                (entra_oid, uid),
            )
        else:
            c.execute(
                "INSERT INTO app.users (id, email, name, entra_oid, status)"
                " VALUES (%s, %s, %s, %s, 'active')",
                (uid, email, name, entra_oid),
            )
        if role is not None:
            c.execute(
                "INSERT INTO app.app_access (user_id, app, role, source) VALUES"
                " (%s, 'kanban', %s, 'global') ON CONFLICT (user_id, app) DO UPDATE"
                " SET role = EXCLUDED.role",
                (uid, role),
            )
        c.execute(
            "INSERT INTO app.session (id, user_id, expires_at)"
            " VALUES (%s, %s, now() + interval '1 hour')",
            (hash_session_id(token), uid),
        )
    return Session(cookie=f"tt_session={token}", user_id=""), uid


def _access(api: Api, email: str) -> list[tuple[Any, ...]]:
    return _sql(
        api,
        "SELECT a.role, a.source, a.updated_by FROM app.app_access a"
        " JOIN app.users u ON u.id = a.user_id WHERE u.email = %s AND a.app = 'kanban'",
        email,
    )


async def _internal(api: Api, method: str, path: str, body: Any = None) -> Any:
    return await api.call(method, path, json=body, headers=INTERNAL, csrf=False)


# ---- §3.1 the suite cookie
async def test_suite_cookie_resolves_the_local_actor_and_links_it(make_api: AppFactory) -> None:
    api = await _api(make_api, "t_py_suite_cookie")
    s, suite_id = _portal_sign_in(api, email_of("M1"), role="member", name="Meera")
    me = await api.call("GET", "/api/v1/me", session=s)
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["user"]["id"] == fixture_id("M1") and body["user"]["role"] == "member"
    assert body["sessionExpiresAt"].endswith("Z")
    # Found by email the first time; linked by suite_user_id from then on.
    assert _sql(api, "SELECT suite_user_id FROM app_user WHERE id = %s", fixture_id("M1")) == [
        (suite_id,)
    ]
    # Kanban's own session table is not written any more.
    assert _sql(api, "SELECT count(*) FROM session") == [(0,)]


async def test_invited_person_is_activated_and_their_entra_id_pinned(
    make_api: AppFactory,
) -> None:
    api = await _api(make_api, "t_py_suite_invited")
    admin = await api.sign_in("ADMIN")
    invited = await api.call(
        "POST",
        "/api/v1/users",
        session=admin,
        json={"name": "Nita", "email": "nita@example.test", "teamIds": [PLATFORM]},
    )
    assert invited.status_code == 201, invited.text
    # The invite was mirrored: the suite knows Nita (invited) with Kanban role member.
    assert _sql(api, "SELECT status FROM app.users WHERE email = 'nita@example.test'") == [
        ("invited",)
    ]
    s, _ = _portal_sign_in(api, "nita@example.test", role="member", entra_oid="oid-nita")
    me = await api.call("GET", "/api/v1/me", session=s)
    assert me.status_code == 200, me.text
    assert _sql(
        api, "SELECT status, external_id FROM app_user WHERE id = %s", invited.json()["id"]
    ) == [("active", "oid-nita")]


async def test_no_kanban_access_is_403_no_app_access(make_api: AppFactory) -> None:
    api = await _api(make_api, "t_py_suite_denied")
    s, _ = _portal_sign_in(api, email_of("M2"), role=None)
    assert_problem(await api.call("GET", "/api/v1/me", session=s), 403, "NO_APP_ACCESS")
    # Anonymous operations still answer for that person.
    assert (await api.call("GET", "/api/v1/auth/config", session=s)).status_code == 200
    # An inactive Kanban account is refused the same way, whatever the suite says.
    gone, _ = _portal_sign_in(api, email_of("GONE"), role="member")
    assert_problem(await api.call("GET", "/api/v1/me", session=gone), 403, "NO_APP_ACCESS")
    # A cookie naming no live session is 401 and is cleared.
    dead = await api.call("GET", "/api/v1/me", session=Session("tt_session=nope", ""))
    assert_problem(dead, 401, "UNAUTHENTICATED")
    assert "tt_session=;" in dead.headers["set-cookie"]


async def test_sign_in_self_heals_a_missing_local_person(make_api: AppFactory) -> None:
    api = await _api(make_api, "t_py_suite_heal")
    s, suite_id = _portal_sign_in(api, "new.admin@example.test", role="admin", name="New Admin")
    me = await api.call("GET", "/api/v1/me", session=s)
    assert me.status_code == 200, me.text
    assert me.json()["user"]["role"] == "admin" and me.json()["user"]["name"] == "New Admin"
    assert _sql(
        api,
        "SELECT role, status, suite_user_id FROM app_user WHERE email = 'new.admin@example.test'",
    ) == [("admin", "active", suite_id)]


# ---- §3.2 internal routes
async def test_internal_routes_need_the_token(make_api: AppFactory) -> None:
    api = await _api(make_api, "t_py_suite_token")
    body = {"email": "x@example.test", "role": "member"}
    for headers in ({}, {"x-internal-token": "wrong"}):
        res = await api.call("POST", "/internal/provision", json=body, headers=headers, csrf=False)
        assert_problem(res, 403, "INTERNAL_TOKEN")
    assert_problem(
        await api.call("GET", "/internal/teams", headers={"x-internal-token": ""}, csrf=False),
        403,
        "INTERNAL_TOKEN",
    )
    # Not configured -> every call refused, even with a header.
    closed = await make_api("t_py_suite_closed")
    res = await closed.call("GET", "/internal/teams", headers=INTERNAL, csrf=False)
    assert_problem(res, 403, "INTERNAL_TOKEN")
    teams = await _internal(api, "GET", "/internal/teams")
    assert teams.status_code == 200
    assert {"id": PLATFORM, "name": "Platform"} in teams.json()
    # Outside the public contract.
    spec = (await api.call("GET", "/api/openapi.json")).json()
    assert not [p for p in spec["paths"] if "internal" in p]


async def test_provision_creates_leads_teams_changes_role_and_revokes(
    make_api: AppFactory,
) -> None:
    api = await _api(make_api, "t_py_suite_provision")
    admin = await api.sign_in("ADMIN")  # gives ADMIN a suite id, the actor below
    admin_suite = _sql(api, "SELECT suite_user_id FROM app_user WHERE id = %s", admin.user_id)[0][0]
    email = "lena@example.test"
    created = await _internal(
        api,
        "POST",
        "/internal/provision",
        {
            "email": "Lena@Example.test",
            "name": "Lena Lead",
            "entra_oid": "oid-lena",
            "role": "lead",
            "kanban_lead_team_ids": [PLATFORM],
            "source": "global",
            "actor_id": admin_suite,
        },
    )
    assert created.status_code == 200, created.text
    local_id = created.json()["local_user_id"]
    assert created.json() == {"ok": True, "local_user_id": local_id, "role": "lead"}
    assert _sql(
        api, "SELECT role, status, external_id, invited_by FROM app_user WHERE id = %s", local_id
    ) == [("member", "invited", "oid-lena", fixture_id("ADMIN"))]
    assert _sql(api, "SELECT team_id, is_lead FROM team_member WHERE user_id = %s", local_id) == [
        (PLATFORM, True)
    ]
    assert _access(api, email) == [("lead", "global", admin_suite)]
    # source=global: the portal sends the one suite invitation, Kanban none.
    assert _sql(api, "SELECT count(*) FROM notification WHERE target_id = %s", local_id) == [(0,)]
    # Leading Web as well: joins it, keeps Platform.
    again = await _internal(
        api,
        "POST",
        "/internal/provision",
        {"email": email, "role": "lead", "kanban_lead_team_ids": [WEB], "actor_id": admin_suite},
    )
    assert again.status_code == 200 and again.json()["local_user_id"] == local_id
    assert sorted(
        _sql(api, "SELECT team_id, is_lead FROM team_member WHERE user_id = %s", local_id)
    ) == sorted([(PLATFORM, True), (WEB, True)])
    # Any other role clears every lead flag; admin is a stored role.
    to_admin = await _internal(
        api, "POST", "/internal/provision", {"email": email, "role": "admin"}
    )
    assert to_admin.json()["role"] == "admin"
    assert _sql(
        api, "SELECT count(*) FROM team_member WHERE user_id = %s AND is_lead", local_id
    ) == [(0,)]
    assert _sql(api, "SELECT role FROM app_user WHERE id = %s", local_id) == [("admin",)]
    assert _access(api, email)[0][0] == "admin"
    # Revoke: inactive locally, access row gone.
    revoked = await _internal(api, "POST", "/internal/provision", {"email": email, "role": None})
    assert revoked.json() == {"ok": True, "local_user_id": local_id, "role": None}
    assert _sql(api, "SELECT status FROM app_user WHERE id = %s", local_id) == [("inactive",)]
    assert _access(api, email) == []
    # Granting again reactivates.
    back = await _internal(api, "POST", "/internal/provision", {"email": email, "role": "member"})
    assert back.json()["role"] == "member"
    assert _sql(api, "SELECT status, role FROM app_user WHERE id = %s", local_id) == [
        ("active", "member")
    ]


async def test_provision_refusals_and_app_source_invitation(make_api: AppFactory) -> None:
    api = await _api(make_api, "t_py_suite_refuse")
    unknown = await _internal(
        api,
        "POST",
        "/internal/provision",
        {"email": "z@example.test", "role": "lead", "kanban_lead_team_ids": ["0" * 26]},
    )
    body = assert_problem(unknown, 422, "TEAM_NOT_FOUND")
    assert body["detail"]
    no_team = await _internal(
        api, "POST", "/internal/provision", {"email": "z@example.test", "role": "lead"}
    )
    assert_problem(no_team, 422, "LEAD_TEAMS_REQUIRED")
    bad_role = await _internal(
        api, "POST", "/internal/provision", {"email": "z@example.test", "role": "owner"}
    )
    assert_problem(bad_role, 422, "INVALID_ROLE")
    # Nothing of the refused calls was kept.
    assert _sql(api, "SELECT count(*) FROM app_user WHERE email = 'z@example.test'") == [(0,)]
    assert _access(api, "z@example.test") == []
    # source=app: Kanban sends its own invitation.
    app_made = await _internal(
        api,
        "POST",
        "/internal/provision",
        {"email": "z@example.test", "role": "member", "source": "app"},
    )
    local_id = app_made.json()["local_user_id"]
    assert _sql(api, "SELECT kind FROM notification WHERE target_id = %s", local_id) == [
        ("invited",)
    ]


async def test_authorize_answers_from_app_access_and_self_heals(make_api: AppFactory) -> None:
    api = await _api(make_api, "t_py_suite_authorize")
    _, denied_id = _portal_sign_in(api, "out@example.test", role=None)
    denied = await _internal(
        api,
        "POST",
        "/internal/authorize",
        {"suite_user_id": denied_id, "email": "out@example.test"},
    )
    assert denied.json() == {"allowed": False, "role": None, "code": "NO_APP_ACCESS"}
    _, heal_id = _portal_sign_in(api, "heal@example.test", role="member", name="Hal")
    healed = await _internal(
        api,
        "POST",
        "/internal/authorize",
        {"suite_user_id": heal_id, "email": "heal@example.test", "name": "Hal"},
    )
    assert healed.json() == {"allowed": True, "role": "member", "code": None}
    assert _sql(
        api,
        "SELECT name, role, status, suite_user_id FROM app_user WHERE email = 'heal@example.test'",
    ) == [("Hal", "member", "active", heal_id)]
    # An inactive Kanban account is not let in.
    _, gone_id = _portal_sign_in(api, email_of("GONE"), role="member")
    gone = await _internal(
        api, "POST", "/internal/authorize", {"suite_user_id": gone_id, "email": email_of("GONE")}
    )
    assert gone.json() == {"allowed": False, "role": None, "code": "LOCAL_USER_INACTIVE"}


# ---- §3.3 mirror hooks
async def test_role_patch_and_lead_toggle_are_mirrored(make_api: AppFactory) -> None:
    api = await _api(make_api, "t_py_suite_mirror")
    admin = await api.sign_in("ADMIN")
    m1 = await api.sign_in("M1")
    admin_suite = _sql(api, "SELECT suite_user_id FROM app_user WHERE id = %s", admin.user_id)[0][0]
    assert _access(api, email_of("M1"))[0][0] == "member"
    lead = await api.call(
        "PATCH",
        f"/api/v1/teams/{PLATFORM}/members/{m1.user_id}",
        session=admin,
        json={"isLead": True},
    )
    assert lead.status_code == 204, lead.text
    assert _access(api, email_of("M1")) == [("lead", "app", admin_suite)]
    promoted = await api.call(
        "PATCH", f"/api/v1/users/{m1.user_id}", session=admin, json={"role": "admin"}
    )
    assert promoted.status_code == 200, promoted.text
    assert _access(api, email_of("M1")) == [("admin", "app", admin_suite)]
    demoted = await api.call(
        "PATCH", f"/api/v1/users/{m1.user_id}", session=admin, json={"role": "member"}
    )
    assert demoted.status_code == 200
    assert _access(api, email_of("M1"))[0][0] == "lead"  # still leads Platform
    removed = await api.call(
        "POST", f"/api/v1/teams/{PLATFORM}/members/{m1.user_id}/removal", session=admin
    )
    assert removed.status_code == 200, removed.text
    assert _access(api, email_of("M1"))[0][0] == "member"
    off = await api.call(
        "PATCH", f"/api/v1/users/{m1.user_id}", session=admin, json={"status": "inactive"}
    )
    assert off.status_code == 200
    assert _access(api, email_of("M1")) == []
    audit = _sql(
        api,
        "SELECT count(*) FROM app.audit_log WHERE action = 'access_changed' AND actor_id = %s",
        admin_suite,
    )
    assert audit[0][0] >= 4


async def test_boot_backfill_mirrors_existing_people_once(make_api: AppFactory) -> None:
    """Kanban's people from before the suite keep their access (app/__main__.py runs this)."""
    from app.__main__ import suite_service

    api = await _api(make_api, "t_py_suite_backfill")
    _sql(api, "UPDATE team_member SET is_lead = true WHERE user_id = %s", fixture_id("M2"))
    maker, clock = api.app.state.sessionmaker, api.app.state.clock
    async with maker() as s:
        assert await suite_service(s, api.settings, clock).backfill() == 3
    async with maker() as s:
        assert await suite_service(s, api.settings, clock).backfill() == 0
    roles = _sql(
        api,
        "SELECT u.email, a.role FROM app.app_access a JOIN app.users u ON u.id = a.user_id"
        " WHERE a.app = 'kanban' ORDER BY u.email",
    )
    assert roles == [
        (email_of("ADMIN"), "admin"),
        (email_of("M1"), "member"),
        (email_of("M2"), "lead"),
    ]
    assert _access(api, email_of("GONE")) == []
