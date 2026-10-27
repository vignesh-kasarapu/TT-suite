"""Org plane (M2): teams, membership and leads, programs and projects (CR-26 date rules,
re-teaming, closure), tags, users and admission. Cards the rules act on are inserted directly,
since the card operations arrive in M3."""

from itertools import count
from typing import Any

import psycopg

from tests.conftest import Api, AppFactory, Session, app_url, assert_problem
from tests.fixtures import fixture_id

PLATFORM = fixture_id("TEAM_PLATFORM")
WEB = fixture_id("TEAM_WEB")
_SEQ = count()


async def _setup(make_api: AppFactory, db: str) -> tuple[Api, Session, Session, Session]:
    api = await make_api(db, APP_SECRET="BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
    api.seed()
    await api.set_clock("2026-06-15T04:30:00Z")
    return api, await api.sign_in("ADMIN"), await api.sign_in("M1"), await api.sign_in("M2")


def _sql(api: Api, query: str, *args: Any) -> list[tuple[Any, ...]]:
    with psycopg.connect(app_url(api.db)) as c:
        cur = c.execute(query, args)
        return cur.fetchall() if cur.description else []


def _card(
    api: Api,
    *,
    owner: str,
    team: str | None,
    assignee: str | None = None,
    project: str | None = None,
    tags: list[str] | None = None,
    closed: bool = False,
) -> tuple[str, int]:
    card_id = fixture_id(f"CARD_{next(_SEQ)}")
    row = _sql(
        api,
        "INSERT INTO card (id, title, plane, owner_id, assignee_id, team_id, project_id, tags,"
        " state, closed_at) VALUES (%s, 'c', 'org', %s, %s, %s, %s, %s, %s, %s) RETURNING number",
        card_id,
        owner,
        assignee,
        team,
        project,
        tags or [],
        "delivered" if closed else "in_development",
        "2026-06-01T00:00:00Z" if closed else None,
    )
    return card_id, int(row[0][0])


async def test_teams_crud_events_and_access(make_api: AppFactory) -> None:
    api, admin, m1, _m2 = await _setup(make_api, "t_py_org_teams")
    created = await api.call(
        "POST", "/api/v1/teams", session=admin, json={"name": "  Data  ", "description": "d"}
    )
    assert created.status_code == 201, created.text
    team = created.json()
    assert team["name"] == "Data" and team["members"] == [] and team["teamsWebhook"] == "not_set"
    assert set(team) >= {"memberCount", "isMember", "createdAt", "updatedAt"}
    assert_problem(
        await api.call("POST", "/api/v1/teams", session=admin, json={"name": "data"}),
        422,
        "NAME_TAKEN",
    )
    assert_problem(
        await api.call("POST", "/api/v1/teams", session=m1, json={"name": "Nope"}), 403, "FORBIDDEN"
    )
    assert_problem(
        await api.call("PATCH", f"/api/v1/teams/{team['id']}", session=m1, json={"name": "X"}),
        403,
        "FORBIDDEN",
    )
    hooked = await api.call(
        "PATCH",
        f"/api/v1/teams/{team['id']}",
        session=admin,
        json={"name": "Data Team", "teamsWebhookUrl": "https://hook.example.test/x"},
    )
    assert hooked.json()["teamsWebhook"] == "set" and hooked.json()["name"] == "Data Team"
    # Add M1, make them lead; a lead may now edit their own team.
    path = f"/api/v1/teams/{team['id']}/members/{m1.user_id}"
    assert (await api.call("PUT", path, session=admin)).status_code == 204
    assert (await api.call("PUT", path, session=admin)).status_code == 204  # idempotent
    api.make_lead(team["id"], m1.user_id)  # a suite role, set by the global admin
    renamed = await api.call(
        "PATCH", f"/api/v1/teams/{team['id']}", session=m1, json={"description": "by lead"}
    )
    assert renamed.status_code == 200 and renamed.json()["members"][0]["isLead"] is True
    assert set(renamed.json()["members"][0]) == {"id", "name", "email", "role", "isLead", "status"}
    listed = (await api.call("GET", "/api/v1/teams", session=m1)).json()["items"]
    mine = next(t for t in listed if t["id"] == team["id"])
    assert mine["isMember"] is True and mine["memberCount"] == 1
    events = (
        await api.call("GET", f"/api/v1/teams/{team['id']}/events?limit=3", session=m1)
    ).json()
    assert events["total"] == 5 and events["limit"] == 3 and len(events["items"]) == 3
    fields = [e["field"] for e in events["items"]]
    assert fields[:2] == ["description", "member_added"]
    assert set(events["items"][0]["actor"]) == {"id", "name", "email", "role"}
    webhook = next(
        e
        for e in (await api.call("GET", f"/api/v1/teams/{team['id']}/events", session=m1)).json()[
            "items"
        ]
        if e["field"] == "teams_webhook"
    )
    assert (webhook["oldValue"], webhook["newValue"]) == ("not_set", "set")
    # Not empty -> 409; empty -> deleted.
    _card(api, owner=m1.user_id, team=team["id"], assignee=m1.user_id)
    assert_problem(
        await api.call("DELETE", f"/api/v1/teams/{team['id']}", session=admin), 409, "NOT_EMPTY"
    )
    empty = (await api.call("POST", "/api/v1/teams", session=admin, json={"name": "Tmp"})).json()
    assert (
        await api.call("DELETE", f"/api/v1/teams/{empty['id']}", session=admin)
    ).status_code == 204
    assert_problem(
        await api.call("GET", f"/api/v1/teams/{empty['id']}", session=m1), 404, "NOT_FOUND"
    )


async def test_member_removal_reassigns_or_releases_in_one_event_group(
    make_api: AppFactory,
) -> None:
    api, admin, m1, m2 = await _setup(make_api, "t_py_org_removal")
    # M2 joins Platform so they can take over one of M1's cards.
    await api.call("PUT", f"/api/v1/teams/{PLATFORM}/members/{m2.user_id}", session=admin)
    keep_id, keep = _card(api, owner=m1.user_id, team=PLATFORM, assignee=m1.user_id)
    drop_id, _ = _card(api, owner=m1.user_id, team=PLATFORM, assignee=m1.user_id)
    closed_id, _ = _card(api, owner=m1.user_id, team=PLATFORM, assignee=m1.user_id, closed=True)
    bad = await api.call(
        "POST",
        f"/api/v1/teams/{PLATFORM}/members/{m1.user_id}/removal",
        session=admin,
        json={"reassignments": [{"key": f"K-{keep}", "assigneeId": fixture_id("GONE")}]},
    )
    assert_problem(bad, 422, "VALIDATION_FAILED")
    res = await api.call(
        "POST",
        f"/api/v1/teams/{PLATFORM}/members/{m1.user_id}/removal",
        session=admin,
        json={"reassignments": [{"key": f"K-{keep}", "assigneeId": m2.user_id}]},
    )
    assert res.status_code == 200 and res.json() == {"reassigned": 1, "released": 1}
    rows = dict(
        (r[0], r[1:])
        for r in _sql(
            api,
            "SELECT id, assignee_id, state, version FROM card WHERE id = ANY(%s)",
            [keep_id, drop_id, closed_id],
        )
    )
    assert rows[keep_id] == (m2.user_id, "in_development", 2)
    assert rows[drop_id] == (None, "backlog", 2)  # CR-17: released -> Backlog
    assert rows[closed_id] == (m1.user_id, "delivered", 1)  # closed cards untouched
    groups = _sql(
        api,
        "SELECT DISTINCT group_id FROM card_event WHERE card_id = ANY(%s)"
        " UNION SELECT group_id FROM org_event WHERE field = 'member_removed'",
        [keep_id, drop_id],
    )
    assert len(groups) == 1
    drop_events = _sql(
        api, "SELECT field, new_value FROM card_event WHERE card_id = %s ORDER BY id", drop_id
    )
    assert drop_events == [("assignee", None), ("state", "backlog")]
    assert_problem(
        await api.call(
            "POST", f"/api/v1/teams/{PLATFORM}/members/{m1.user_id}/removal", session=admin
        ),
        404,
        "NOT_FOUND",
    )


async def test_programs_projects_cr26_reteam_and_closure(make_api: AppFactory) -> None:
    api, admin, m1, _m2 = await _setup(make_api, "t_py_org_projects")
    _sql(api, "UPDATE team_member SET is_lead = true WHERE user_id = %s", m1.user_id)
    prog = await api.call(
        "POST",
        "/api/v1/programs",
        session=admin,
        json={"name": "Launch", "targetDate": "2026-09-30"},
    )
    assert prog.status_code == 201 and prog.json()["projects"] == []
    pid = prog.json()["id"]
    assert_problem(
        await api.call(
            "POST", "/api/v1/programs", session=admin, json={"name": "X", "targetDate": 20260930}
        ),
        422,
        "VALIDATION_FAILED",
    )
    # A lead may create a project in their team, but not inside a program (CR-26).
    assert_problem(
        await api.call(
            "POST",
            "/api/v1/projects",
            session=m1,
            json={"name": "P", "teamId": PLATFORM, "programId": pid},
        ),
        403,
        "FORBIDDEN",
    )
    assert_problem(
        await api.call("POST", "/api/v1/projects", session=m1, json={"name": "P", "teamId": WEB}),
        403,
        "FORBIDDEN",
    )
    conflict = await api.call(
        "POST",
        "/api/v1/projects",
        session=admin,
        json={"name": "Core", "teamId": PLATFORM, "programId": pid, "targetDate": "2026-11-15"},
    )
    assert assert_problem(conflict, 422, "DATE_CONFLICT")["errors"][0]["message"] == "2026-09-30"
    shrunk = await api.call(
        "POST",
        "/api/v1/projects",
        session=admin,
        json={
            "name": "Core",
            "teamId": PLATFORM,
            "programId": pid,
            "targetDate": "2026-11-15",
            "dateConflict": "shrink_project",
        },
    )
    assert shrunk.status_code == 201 and shrunk.json()["targetDate"] == "2026-09-30"
    project = shrunk.json()
    assert project["team"] == {"id": PLATFORM, "name": "Platform"}
    assert project["program"] == {"id": pid, "name": "Launch"}
    assert (project["closedAt"], project["closedBy"], project["cardCount"]) == (None, None, 0)
    assert_problem(
        await api.call(
            "POST",
            "/api/v1/projects",
            session=admin,
            json={"name": "core", "teamId": PLATFORM},
        ),
        422,
        "NAME_TAKEN",
    )
    extended = await api.call(
        "PATCH",
        f"/api/v1/projects/{project['id']}",
        session=admin,
        json={"targetDate": "2026-12-01", "dateConflict": "extend_program"},
    )
    assert extended.json()["targetDate"] == "2026-12-01"
    detail = (await api.call("GET", f"/api/v1/programs/{pid}", session=m1)).json()
    assert detail["targetDate"] == "2026-12-01" and detail["derivedTargetDate"] == "2026-12-01"
    assert detail["projectCount"] == 1
    # Pulling the program end before the project asks; shrink moves the project.
    assert_problem(
        await api.call(
            "PATCH", f"/api/v1/programs/{pid}", session=admin, json={"targetDate": "2026-10-01"}
        ),
        422,
        "DATE_CONFLICT",
    )
    await api.call(
        "PATCH",
        f"/api/v1/programs/{pid}",
        session=admin,
        json={"targetDate": "2026-10-01", "dateConflict": "shrink_project"},
    )
    moved = (await api.call("GET", f"/api/v1/projects/{project['id']}", session=m1)).json()
    assert moved["targetDate"] == "2026-10-01"
    # Re-teaming moves the project's cards with one `team` event each (D-046).
    card_id, card_no = _card(
        api, owner=m1.user_id, team=PLATFORM, assignee=m1.user_id, project=project["id"]
    )
    reteam = await api.call(
        "PATCH", f"/api/v1/projects/{project['id']}", session=admin, json={"teamId": WEB}
    )
    assert reteam.status_code == 200 and reteam.json()["team"]["name"] == "Web"
    assert _sql(api, "SELECT team_id, version FROM card WHERE id = %s", card_id) == [(WEB, 2)]
    ev = _sql(api, "SELECT old_value, new_value FROM card_event WHERE card_id = %s", card_id)
    assert ev == [({"id": PLATFORM, "name": "Platform"}, {"id": WEB, "name": "Web"})]
    # Intake stop is admin-only (CR-12); a non-admin lead of the old team can no longer edit.
    assert_problem(
        await api.call(
            "PATCH", f"/api/v1/projects/{project['id']}", session=m1, json={"accepting": False}
        ),
        403,
        "FORBIDDEN",
    )
    assert_problem(
        await api.call("DELETE", f"/api/v1/projects/{project['id']}", session=admin),
        409,
        "NOT_EMPTY",
    )
    # Closure: every open card must be named.
    missing = await api.call(
        "POST",
        f"/api/v1/projects/{project['id']}/closure",
        session=admin,
        json={"comment": "done", "cards": []},
    )
    assert assert_problem(missing, 422, "OPEN_CARDS")["errors"] == [
        {"field": "cards", "code": "OPEN_CARD", "message": f"K-{card_no}"}
    ]
    closed = await api.call(
        "POST",
        f"/api/v1/projects/{project['id']}/closure",
        session=admin,
        json={"comment": "done", "cards": [{"key": f"K-{card_no}", "state": "delivered"}]},
    )
    body = closed.json()
    assert closed.status_code == 200 and body["closedAt"] == "2026-06-15T04:30:00.000Z"
    assert body["closedBy"]["id"] == admin.user_id and "status" not in body["closedBy"]
    assert (body["openCardCount"], body["cardCount"]) == (0, 1)
    assert _sql(api, "SELECT state, closed_at IS NOT NULL FROM card WHERE id = %s", card_id) == [
        ("delivered", True)
    ]
    assert _sql(api, "SELECT body FROM card_comment WHERE card_id = %s", card_id) == [("done",)]
    assert (await api.call("GET", "/api/v1/projects", session=m1)).json()[
        "items"
    ] == []  # closed ones only on request
    listed = (await api.call("GET", "/api/v1/projects?includeClosed=true", session=m1)).json()
    assert [p["id"] for p in listed["items"]] == [project["id"]]
    reopened = await api.call("DELETE", f"/api/v1/projects/{project['id']}/closure", session=admin)
    assert reopened.json()["closedAt"] is None
    assert_problem(
        await api.call("DELETE", f"/api/v1/projects/{project['id']}/closure", session=admin),
        422,
        "NOT_CLOSED",
    )
    assert_problem(
        await api.call("DELETE", f"/api/v1/programs/{pid}", session=admin), 409, "NOT_EMPTY"
    )


async def test_tags_crud_rename_cascade_and_delete_when_unused(make_api: AppFactory) -> None:
    api, admin, m1, _m2 = await _setup(make_api, "t_py_org_tags")
    made = await api.call("POST", "/api/v1/tags", session=admin, json={"name": " infra "})
    assert made.status_code == 201 and made.json()["name"] == "infra"
    assert made.json()["cardCount"] == 0
    assert_problem(
        await api.call("POST", "/api/v1/tags", session=admin, json={"name": "INFRA"}),
        422,
        "NAME_TAKEN",
    )
    assert_problem(
        await api.call("POST", "/api/v1/tags", session=m1, json={"name": "x"}), 403, "FORBIDDEN"
    )
    card_id, _ = _card(api, owner=m1.user_id, team=PLATFORM, tags=["infra", "bug"])
    renamed = await api.call(
        "PATCH", f"/api/v1/tags/{made.json()['id']}", session=admin, json={"name": "platform"}
    )
    assert renamed.json()["cardCount"] == 1
    assert _sql(api, "SELECT tags, version FROM card WHERE id = %s", card_id) == [
        (["platform", "bug"], 2)
    ]
    tags = (await api.call("GET", "/api/v1/tags", session=m1)).json()["items"]
    assert next(t for t in tags if t["name"] == "platform")["cardCount"] == 1
    assert [t["name"].lower() for t in tags] == sorted(t["name"].lower() for t in tags)
    assert_problem(
        await api.call("DELETE", f"/api/v1/tags/{made.json()['id']}", session=admin),
        409,
        "NOT_EMPTY",
    )
    unused = fixture_id("TAG_keep")
    assert (await api.call("DELETE", f"/api/v1/tags/{unused}", session=admin)).status_code == 204
    assert_problem(
        await api.call("DELETE", f"/api/v1/tags/{unused}", session=admin), 404, "NOT_FOUND"
    )


async def test_users_list_and_no_account_or_role_writes(make_api: AppFactory) -> None:
    """TT Suite: only the global admin (in the portal) creates accounts and assigns roles;
    Kanban's own invite, role, status, re-invite, directory and lead-toggle routes are gone."""
    api, admin, m1, _m2 = await _setup(make_api, "t_py_org_users")
    active = (await api.call("GET", "/api/v1/users?status=all", session=m1)).json()["items"]
    assert fixture_id("GONE") not in [u["id"] for u in active]  # members see active people only
    everyone = (await api.call("GET", "/api/v1/users?status=all", session=admin)).json()["items"]
    assert fixture_id("GONE") in [u["id"] for u in everyone]
    assert set(everyone[0]) == {"id", "name", "email", "role", "status", "photoUpdatedAt"}
    body = {"name": "N", "email": "n@example.test", "teamIds": [PLATFORM]}
    for method, path, json in (
        ("POST", "/api/v1/users", body),
        ("PATCH", f"/api/v1/users/{m1.user_id}", {"role": "admin"}),
        ("POST", f"/api/v1/users/{m1.user_id}/invite", None),
        ("GET", "/api/v1/users/directory?q=ni", None),
        ("PATCH", f"/api/v1/teams/{PLATFORM}/members/{m1.user_id}", {"isLead": True}),
    ):
        res = await api.call(method, path, session=admin, json=json)
        assert res.status_code in (404, 405), (path, res.status_code)
    assert _sql(api, "SELECT role, status FROM app_user WHERE id = %s", m1.user_id) == [
        ("member", "active")
    ]


async def test_team_members_carry_status_and_invited_ones_cannot_hold_a_card(
    make_api: AppFactory,
) -> None:
    """D-126: a team's members say who has signed in; an invited person is listed but refused as
    an assignee until their first sign-in (the card pickers offer only active people)."""
    api, admin, m1, _m2 = await _setup(make_api, "t_py_org_member_status")
    nita = _sql(
        api,
        "INSERT INTO app_user (id, email, name, role, status, created_at, updated_at)"
        " VALUES (%s, 'nita@example.test', 'Nita', 'member', 'invited', now(), now()) RETURNING id",
        fixture_id("NITA"),
    )[0][0]
    added = await api.call("PUT", f"/api/v1/teams/{PLATFORM}/members/{nita}", session=admin)
    assert added.status_code == 422  # only active people join a team from Kanban
    _sql(
        api,
        "INSERT INTO team_member (team_id, user_id, added_by, added_at) VALUES (%s, %s, %s, now())",
        PLATFORM,
        nita,
        admin.user_id,
    )
    team = (await api.call("GET", f"/api/v1/teams/{PLATFORM}", session=m1)).json()
    status = {m["id"]: m["status"] for m in team["members"]}
    assert status[nita] == "invited"
    assert status[m1.user_id] == "active"
    refused = await api.call(
        "POST",
        "/api/v1/cards",
        session=m1,
        json={"title": "For Nita", "plane": "org", "teamId": PLATFORM, "assigneeId": nita},
    )
    assert_problem(refused, 422, "VALIDATION_FAILED")
