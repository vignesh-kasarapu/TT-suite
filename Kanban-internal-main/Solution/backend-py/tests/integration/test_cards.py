"""Cards (M3): visibility matrix (NFR-006, CR-14/28), placement and assignment (CR-17/22, D-095),
versions and events (FR-041), closed card / closed project (CR-24/12), boards and search,
comments, links and trees, time entries (CR-13/21), attachments, plane copy (D-056)."""

from typing import Any

import psycopg

from app.services.link_service import cycles
from tests.conftest import Api, AppFactory, Session, app_url, assert_problem
from tests.fixtures import fixture_id

PLATFORM = fixture_id("TEAM_PLATFORM")
WEB = fixture_id("TEAM_WEB")


async def _api(make_api: AppFactory, db: str) -> tuple[Api, Session, Session, Session]:
    api = await make_api(db)
    api.seed()
    await api.set_clock("2026-06-15T04:30:00Z")
    return api, await api.sign_in("ADMIN"), await api.sign_in("M1"), await api.sign_in("M2")


async def _card(api: Api, s: Session, **body: Any) -> dict[str, Any]:
    res = await api.call("POST", "/api/v1/cards", session=s, json={"title": "t", **body})
    assert res.status_code == 201, res.text
    card: dict[str, Any] = res.json()
    return card


def _events(api: Api, card_id: str) -> list[tuple[str, Any, Any]]:
    with psycopg.connect(app_url(api.db)) as c:
        rows = c.execute(
            "SELECT field, old_value, new_value FROM card_event WHERE card_id = %s ORDER BY id",
            (card_id,),
        ).fetchall()
    return [(r[0], r[1], r[2]) for r in rows]


async def test_visibility_matrix_private_and_other_team(make_api: AppFactory) -> None:
    api, admin, m1, m2 = await _api(make_api, "t_py_cards_vis")
    private = await _card(api, m1, title="mine only")
    org = await _card(api, m1, title="platform work", plane="org")
    assert org["teamId"] == PLATFORM and org["assigneeId"] == m1.user_id  # CR-22, CR-17
    # Private: the owner only - admins included in "nobody else", and 404 (no leak).
    for s in (admin, m2):
        assert_problem(
            await api.call("GET", f"/api/v1/cards/{private['key']}", session=s), 404, "NOT_FOUND"
        )
    # Org card of another team: 403 naming the team (CR-28); admins read it.
    other = assert_problem(
        await api.call("GET", f"/api/v1/cards/{org['key']}", session=m2), 403, "OTHER_TEAM"
    )
    assert other["detail"].endswith("another team - Platform.")
    assert (await api.call("GET", f"/api/v1/cards/{org['key']}", session=admin)).status_code == 200
    # Nor does search or any board show them.
    found = (await api.call("GET", "/api/v1/cards?q=mine", session=admin)).json()
    assert found["total"] == 0
    assert_problem(
        await api.call("GET", f"/api/v1/boards/teams/{PLATFORM}", session=m2), 403, "OTHER_TEAM"
    )
    assert_problem(await api.call("GET", "/api/v1/cards/K-999999", session=m1), 404, "NOT_FOUND")


async def test_create_update_move_events_versions_and_closed_rules(make_api: AppFactory) -> None:
    api, admin, m1, m2 = await _api(make_api, "t_py_cards_life")
    # CR-22: an admin in no team must pick; an unknown tag is refused.
    no_team = await api.call(
        "POST", "/api/v1/cards", session=admin, json={"title": "x", "plane": "org"}
    )
    assert assert_problem(no_team, 422, "VALIDATION_FAILED")["errors"][0]["code"] == "TEAM_REQUIRED"
    unknown = await api.call(
        "POST", "/api/v1/cards", session=m1, json={"title": "x", "tags": ["nope"]}
    )
    assert_problem(unknown, 422, "UNKNOWN_TAG")
    card = await _card(
        api, m1, plane="org", tags=["URGENT"], eta="2026-07-01", effortHours=2, assigneeId=None
    )
    # Canonical tag; D-147: an explicit null still leaves the creator holding a new card.
    assert card["tags"] == ["urgent"] and card["assigneeId"] == m1.user_id
    assert card["effortHours"] == 2 and card["eta"] == "2026-07-01" and card["version"] == 1
    assert card["loggedHours"] == 0 and card["key"] == f"K-{card['number']}"
    key = card["key"]
    # Stale version -> 409; a real change -> one group of events, version + 1.
    stale = await api.call(
        "PATCH", f"/api/v1/cards/{key}", session=m1, json={"version": 9, "title": "x"}
    )
    assert_problem(stale, 409, "STALE_VERSION")
    patched = await api.call(
        "PATCH",
        f"/api/v1/cards/{key}",
        session=m1,
        json={"version": 1, "title": "renamed", "priority": 1, "assigneeId": admin.user_id},
    )
    assert patched.status_code == 200 and patched.json()["version"] == 2
    fields = [e[0] for e in _events(api, card["id"])]
    assert fields == ["created", "title", "assignee", "priority"]
    assert _events(api, card["id"])[2][2] == {"id": admin.user_id, "name": "Asha Admin"}
    # Clearing the assignee drops an open org card to Backlog (CR-17).
    await api.call(
        "POST", f"/api/v1/cards/{key}/move", session=admin, json={"state": "ready", "version": 2}
    )
    cleared = await api.call(
        "PATCH", f"/api/v1/cards/{key}", session=admin, json={"version": 3, "assigneeId": None}
    )
    assert cleared.json()["state"] == "backlog"
    # A member of another team cannot write; an admin can.
    assert_problem(
        await api.call(
            "PATCH", f"/api/v1/cards/{key}", session=m2, json={"version": 4, "title": "y"}
        ),
        403,
        "OTHER_TEAM",
    )
    # Moving to the other team: the holder cannot follow, so the card arrives unheld (D-095).
    held = await api.call(
        "PATCH", f"/api/v1/cards/{key}", session=m1, json={"version": 4, "assigneeId": m1.user_id}
    )
    moved = await api.call(
        "PATCH",
        f"/api/v1/cards/{key}",
        session=admin,
        json={"version": held.json()["version"], "teamId": WEB},
    )
    assert moved.json()["teamId"] == WEB and moved.json()["assigneeId"] is None
    assert_problem(
        await api.call(
            "PATCH",
            f"/api/v1/cards/{key}",
            session=admin,
            json={"version": moved.json()["version"], "teamId": None},
        ),
        422,
        "VALIDATION_FAILED",
    )
    # Closing: closedAt set; then read-only for everyone except comments (CR-24).
    closed = await api.call(
        "POST",
        f"/api/v1/cards/{key}/move",
        session=admin,
        json={"state": "delivered", "version": moved.json()["version"]},
    )
    assert closed.json()["closedAt"] == "2026-06-15T04:30:00.000Z"
    assert_problem(
        await api.call(
            "POST",
            f"/api/v1/cards/{key}/move",
            session=admin,
            json={"state": "ready", "version": closed.json()["version"]},
        ),
        403,
        "CARD_CLOSED",
    )
    comment = await api.call(
        "POST", f"/api/v1/cards/{key}/comments", session=admin, json={"body": "after"}
    )
    assert comment.status_code == 201


async def test_boards_order_filters_and_search(make_api: AppFactory) -> None:
    api, _admin, m1, _m2 = await _api(make_api, "t_py_cards_boards")
    late = await _card(api, m1, title="late", priority=2, eta="2026-08-01")
    soon = await _card(api, m1, title="soon", priority=2, eta="2026-06-20")
    none = await _card(api, m1, title="no eta", priority=2)
    top = await _card(api, m1, title="zzfind top", priority=1, tags=["zzfind"])
    board = (await api.call("GET", "/api/v1/boards/private", session=m1)).json()["columns"]
    assert set(board) == {
        "backlog",
        "in_prep",
        "ready",
        "in_development",
        "uat",
        "delivered",
        "cancelled",
    }
    assert [c["key"] for c in board["backlog"]] == [
        top["key"],
        soon["key"],
        late["key"],
        none["key"],
    ]
    tagged = (await api.call("GET", "/api/v1/boards/private?tag=zzfind", session=m1)).json()
    assert [c["key"] for c in tagged["columns"]["backlog"]] == [top["key"]]
    # Closed cards leave the board after 14 days unless asked for.
    await api.call(
        "POST",
        f"/api/v1/cards/{late['key']}/move",
        session=m1,
        json={"state": "cancelled", "version": 1},
    )
    await api.set_clock("2026-07-01T04:30:00Z")
    m1 = await api.sign_in("M1")  # sessions last SESSION_HOURS: sign in again after the jump
    gone = (await api.call("GET", "/api/v1/boards/private", session=m1)).json()["columns"]
    assert gone["cancelled"] == []
    kept = (await api.call("GET", "/api/v1/boards/private?includeClosed=true", session=m1)).json()
    assert len(kept["columns"]["cancelled"]) == 1
    # Search: text over key/title/tag, exact key first, paginated.
    hits = (await api.call("GET", "/api/v1/cards?q=zzfind&limit=1", session=m1)).json()
    assert hits["total"] == 1 and hits["items"][0]["key"] == top["key"] and hits["limit"] == 1
    exact = (await api.call("GET", f"/api/v1/cards?q={soon['key'].lower()}", session=m1)).json()
    assert exact["items"][0]["key"] == soon["key"]
    assert set(exact["items"][0]) == {
        "id",
        "key",
        "title",
        "plane",
        "state",
        "priority",
        "teamId",
        "projectId",
        "assigneeId",
        "eta",
        "closedAt",
    }


async def test_comments_links_trees_time_and_attachments(make_api: AppFactory) -> None:
    api, admin, m1, m2 = await _api(make_api, "t_py_cards_parts")
    a = await _card(api, m1, title="A", plane="org")
    b = await _card(api, m1, title="B", plane="org", dependsOnKey=a["key"])
    assert b["version"] == 2  # the depends_on link bumped it in the same transaction
    # Links: duplicate refused; blocks is active while the blocker is open.
    blocks = await api.call(
        "POST",
        f"/api/v1/cards/{a['key']}/links",
        session=m1,
        json={"type": "blocks", "targetKey": b["key"]},
    )
    assert blocks.status_code == 201 and blocks.json()["active"] is True
    dup = await api.call(
        "POST",
        f"/api/v1/cards/{b['key']}/links",
        session=m1,
        json={"type": "depends_on", "targetKey": a["key"]},
    )
    assert_problem(dup, 422, "DUPLICATE_LINK")
    links = (await api.call("GET", f"/api/v1/cards/{b['key']}/links", session=m1)).json()["items"]
    assert {(lk["type"], lk["direction"]) for lk in links} == {
        ("depends_on", "out"),
        ("blocks", "in"),
    }
    # A cycle shows in the project tree.
    project = (
        await api.call(
            "POST", "/api/v1/projects", session=admin, json={"name": "Tree", "teamId": PLATFORM}
        )
    ).json()
    for card in (a, b):
        fresh = (await api.call("GET", f"/api/v1/cards/{card['key']}", session=m1)).json()
        await api.call(
            "PATCH",
            f"/api/v1/cards/{card['key']}",
            session=m1,
            json={"version": fresh["version"], "projectId": project["id"]},
        )
    await api.call(
        "POST",
        f"/api/v1/cards/{a['key']}/links",
        session=m1,
        json={"type": "depends_on", "targetKey": b["key"]},
    )
    tree = (await api.call("GET", f"/api/v1/projects/{project['id']}/tree", session=m1)).json()
    assert len(tree["nodes"]) == 2 and len(tree["edges"]) == 2
    assert tree["cycles"] == [sorted([a["id"], b["id"]])]
    # Comments: reply one level only, votes, author-only edit, no delete while replied to.
    top = (
        await api.call(
            "POST", f"/api/v1/cards/{a['key']}/comments", session=m1, json={"body": "hi"}
        )
    ).json()
    reply = await api.call(
        "POST",
        f"/api/v1/cards/{a['key']}/comments",
        session=admin,
        json={"body": "re", "parentId": top["id"]},
    )
    assert reply.json()["parentId"] == top["id"]
    nested = await api.call(
        "POST",
        f"/api/v1/cards/{a['key']}/comments",
        session=m1,
        json={"body": "x", "parentId": reply.json()["id"]},
    )
    assert assert_problem(nested, 422, "VALIDATION_FAILED")["errors"][0]["code"] == "NOT_TOP_LEVEL"
    voted = await api.call(
        "PUT",
        f"/api/v1/cards/{a['key']}/comments/{top['id']}/vote",
        session=admin,
        json={"value": 1},
    )
    assert (voted.json()["up"], voted.json()["myVote"]) == (1, 1)
    assert_problem(
        await api.call(
            "PATCH",
            f"/api/v1/cards/{a['key']}/comments/{top['id']}",
            session=admin,
            json={"body": "z"},
        ),
        403,
        "FORBIDDEN",
    )
    assert_problem(
        await api.call("DELETE", f"/api/v1/cards/{a['key']}/comments/{top['id']}", session=m1),
        409,
        "NOT_EMPTY",
    )
    # Time: 24 h per person per date across cards; a member sees only their own entries.
    entry = await api.call(
        "POST",
        f"/api/v1/cards/{a['key']}/time",
        session=m1,
        json={"date": "2026-06-14", "hours": 20},
    )
    assert entry.status_code == 201 and entry.json()["hours"] == 20
    capped = await api.call(
        "POST",
        f"/api/v1/cards/{b['key']}/time",
        session=m1,
        json={"date": "2026-06-14", "hours": 4.5},
    )
    assert assert_problem(capped, 422, "VALIDATION_FAILED")["errors"][0]["code"] == "DAY_CAP"
    await api.call(
        "POST",
        f"/api/v1/cards/{a['key']}/time",
        session=admin,
        json={"date": "2026-06-14", "hours": 1.5},
    )
    mine = (await api.call("GET", f"/api/v1/cards/{a['key']}/time", session=m1)).json()
    assert (mine["scope"], mine["total"], len(mine["items"])) == ("own", 20, 1)
    everyone = (await api.call("GET", f"/api/v1/cards/{a['key']}/time", session=admin)).json()
    assert (everyone["scope"], everyone["total"]) == ("all", 21.5)
    seen = (await api.call("GET", f"/api/v1/cards/{a['key']}", session=m1)).json()["loggedHours"]
    assert seen == 20  # CR-13: a member's view counts their own hours only
    # Attachments: http(s) only; project common links by the team.
    bad = await api.call(
        "POST",
        f"/api/v1/cards/{a['key']}/attachments",
        session=m1,
        json={"title": "x", "url": "ftp://a.b/c"},
    )
    assert_problem(bad, 422, "VALIDATION_FAILED")
    att = await api.call(
        "POST",
        f"/api/v1/cards/{a['key']}/attachments",
        session=m1,
        json={"title": " Spec ", "url": "https://docs.example.test/spec", "kind": "spec"},
    )
    assert att.status_code == 201 and att.json()["title"] == "Spec"
    assert_problem(
        await api.call(
            "POST",
            f"/api/v1/projects/{project['id']}/attachments",
            session=m2,
            json={"title": "x", "url": "https://x.example.test"},
        ),
        403,
        "FORBIDDEN",
    )
    docs = (await api.call("GET", f"/api/v1/projects/{project['id']}/documents", session=m1)).json()
    assert docs["common"] == [] and docs["byCard"][0]["card"]["key"] == a["key"]


async def test_plane_copy_private_to_org_with_cancel(make_api: AppFactory) -> None:
    api, _admin, m1, m2 = await _api(make_api, "t_py_cards_copy")
    src = await _card(api, m1, title="idea", tags=["idea"])
    note = (
        await api.call(
            "POST", f"/api/v1/cards/{src['key']}/comments", session=m1, json={"body": "n"}
        )
    ).json()
    fresh = (await api.call("GET", f"/api/v1/cards/{src['key']}", session=m1)).json()
    assert_problem(
        await api.call(
            "POST",
            f"/api/v1/cards/{src['key']}/copies",
            session=m1,
            json={
                "targetPlane": "private",
                "version": fresh["version"],
                "commentIds": [],
                "eventIds": [],
            },
        ),
        422,
        "SAME_PLANE",
    )
    copy = await api.call(
        "POST",
        f"/api/v1/cards/{src['key']}/copies",
        session=m1,
        json={
            "targetPlane": "org",
            "version": fresh["version"],
            "commentIds": [note["id"]],
            "eventIds": [],
            "cancelSource": True,
        },
    )
    assert copy.status_code == 201, copy.text
    made = copy.json()
    assert (made["plane"], made["teamId"], made["title"], made["tags"]) == (
        "org",
        PLATFORM,
        "idea",
        ["idea"],
    )
    assert made["assigneeId"] == m1.user_id  # D-147: the copier holds an org copy
    comments = (await api.call("GET", f"/api/v1/cards/{made['key']}/comments", session=m1)).json()[
        "items"
    ]
    assert comments[0]["copiedFromKey"] == src["key"] and comments[0]["body"] == "n"
    source = (await api.call("GET", f"/api/v1/cards/{src['key']}", session=m1)).json()
    assert source["state"] == "cancelled" and source["closedAt"] is not None
    history = (await api.call("GET", f"/api/v1/cards/{src['key']}/events", session=m1)).json()
    assert [e["field"] for e in history["items"][:3]] == ["state", "copied_to", "link_added"]
    created = _events(api, made["id"])[0]
    assert created[0] == "created" and created[2]["copiedFromKey"] == src["key"]
    # The org copy is invisible to another team's member.
    assert_problem(
        await api.call("GET", f"/api/v1/cards/{made['key']}", session=m2), 403, "OTHER_TEAM"
    )


def test_cycles_are_strongly_connected_components() -> None:
    edges = [("l1", "a", "b"), ("l2", "b", "c"), ("l3", "c", "a"), ("l4", "c", "d")]
    assert cycles(["a", "b", "c", "d"], edges) == [["a", "b", "c"]]
    assert cycles(["a", "b"], [("l", "a", "b")]) == []


async def test_overdue_flag_follows_the_report_rule(make_api: AppFactory) -> None:
    """D-152: `overdue` = open with an ETA before today in ORG_TZ (the clock is 15 Jun 2026)."""
    api, _admin, m1, _m2 = await _api(make_api, "t_py_cards_overdue")
    late = await _card(api, m1, plane="org", eta="2026-06-14")
    due_today = await _card(api, m1, plane="org", eta="2026-06-15")
    no_eta = await _card(api, m1, plane="org")
    assert (late["overdue"], due_today["overdue"], no_eta["overdue"]) == (True, False, False)
    board = (await api.call("GET", "/api/v1/boards/my-org", session=m1)).json()["columns"]
    assert [c["overdue"] for c in board["backlog"] if c["key"] == late["key"]] == [True]
    # Delivered (closed) is never overdue.
    moved = await api.call(
        "POST",
        f"/api/v1/cards/{late['key']}/move",
        session=m1,
        json={"state": "delivered", "version": late["version"]},
    )
    assert moved.status_code == 200 and moved.json()["overdue"] is False
