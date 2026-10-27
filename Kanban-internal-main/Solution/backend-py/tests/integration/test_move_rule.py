"""D-117 / FR-087: only the person working on a card moves it - its assignee, a lead of its team
or an admin; an unassigned card is claimed first. `canMove` tells each caller."""

from typing import Any

from tests.conftest import Api, AppFactory, Session, assert_problem
from tests.fixtures import fixture_id

PLATFORM = fixture_id("TEAM_PLATFORM")


async def _move(api: Api, s: Session, card: dict[str, Any], state: str) -> Any:
    return await api.call(
        "POST",
        f"/api/v1/cards/{card['key']}/move",
        session=s,
        json={"state": state, "version": card["version"]},
    )


async def _get(api: Api, s: Session, key: str) -> dict[str, Any]:
    res = await api.call("GET", f"/api/v1/cards/{key}", session=s)
    assert res.status_code == 200, res.text
    card: dict[str, Any] = res.json()
    return card


async def test_assignee_lead_and_admin_move_others_do_not(make_api: AppFactory) -> None:
    api = await make_api("t_py_move_rule")
    api.seed()
    admin, m1, m2 = await api.sign_in("ADMIN"), await api.sign_in("M1"), await api.sign_in("M2")
    member = f"/api/v1/teams/{PLATFORM}/members/{m2.user_id}"
    assert (await api.call("PUT", member, session=admin)).status_code == 204
    made = await api.call(
        "POST",
        "/api/v1/cards",
        session=m1,
        json={"title": "Mine", "plane": "org", "teamId": PLATFORM, "state": "ready"},
    )
    card: dict[str, Any] = made.json()
    assert card["assigneeId"] == m1.user_id and card["canMove"] is True
    # Another member of the team sees it, may edit it, but may not move it.
    seen = await _get(api, m2, card["key"])
    assert seen["canMove"] is False
    assert_problem(await _move(api, m2, seen, "uat"), 403, "NOT_ASSIGNEE")
    edited = await api.call(
        "PATCH",
        f"/api/v1/cards/{card['key']}",
        session=m2,
        json={"version": seen["version"], "priority": 1},
    )
    assert edited.status_code == 200, edited.text
    board = (await api.call("GET", f"/api/v1/boards/teams/{PLATFORM}", session=m2)).json()
    flags = {c["key"]: c["canMove"] for col in board["columns"].values() for c in col}
    assert flags[card["key"]] is False
    # The assignee moves it.
    card = await _get(api, m1, card["key"])
    moved = await _move(api, m1, card, "in_development")
    assert moved.status_code == 200 and moved.json()["state"] == "in_development"
    # A lead of the card's team may; so may an admin.
    api.make_lead(PLATFORM, m2.user_id)
    card = await _get(api, m2, card["key"])
    assert card["canMove"] is True
    assert (await _move(api, m2, card, "uat")).status_code == 200
    card = await _get(api, admin, card["key"])
    assert card["canMove"] is True
    assert (await _move(api, admin, card, "in_development")).status_code == 200


async def test_unassigned_is_claimed_first_private_and_closed(make_api: AppFactory) -> None:
    api = await make_api("t_py_move_claim")
    api.seed()
    m1 = await api.sign_in("M1")
    made = await api.call(
        "POST",
        "/api/v1/cards",
        session=m1,
        json={"title": "Nobody's", "plane": "org", "teamId": PLATFORM, "assigneeId": None},
    )
    # D-147: a new card always has a holder; releasing it is what leaves nobody (and Backlog).
    assert made.json()["assigneeId"] == m1.user_id
    released = await api.call(
        "PATCH",
        f"/api/v1/cards/{made.json()['key']}",
        session=m1,
        json={"version": made.json()["version"], "assigneeId": None},
    )
    card: dict[str, Any] = released.json()
    assert card["state"] == "backlog"
    assert card["assigneeId"] is None and card["canMove"] is False
    assert_problem(await _move(api, m1, card, "ready"), 403, "NOT_ASSIGNEE")
    claimed = await api.call(
        "PATCH",
        f"/api/v1/cards/{card['key']}",
        session=m1,
        json={"version": card["version"], "assigneeId": m1.user_id},
    )
    assert claimed.status_code == 200 and claimed.json()["canMove"] is True
    done = await _move(api, m1, claimed.json(), "delivered")
    assert done.status_code == 200
    # Closed: nobody moves it any more (CR-24 says why).
    assert done.json()["canMove"] is False
    # A private card is its owner's to move.
    private = (
        await api.call(
            "POST", "/api/v1/cards", session=m1, json={"title": "Me", "plane": "private"}
        )
    ).json()
    assert private["canMove"] is True
    assert (await _move(api, m1, private, "ready")).status_code == 200


async def test_unassigned_board_lists_only_cards_nobody_holds(make_api: AppFactory) -> None:
    """D-122: the Unassigned board is for claiming - a card someone holds is never on it,
    whatever its team; `mode=no_team` narrows it to unassigned cards without a team."""
    import psycopg

    from tests.conftest import owner_url

    api = await make_api("t_py_unassigned")
    api.seed()
    m1 = await api.sign_in("M1")

    async def make(title: str, assignee: str | None) -> dict[str, Any]:
        res = await api.call(
            "POST",
            "/api/v1/cards",
            session=m1,
            json={"title": title, "plane": "org", "teamId": PLATFORM, "assigneeId": assignee},
        )
        assert res.status_code == 201, res.text
        card: dict[str, Any] = res.json()
        return card

    free = await make("Free", None)
    held = await make("Held", m1.user_id)
    free_teamless = await make("Free no team", None)
    held_teamless = await make("Held no team", m1.user_id)
    # Legacy cards without a team (CR-22 forbids creating them now), and cards nobody holds
    # outside Backlog (D-147: a new card is always held; releasing one drops it to Backlog).
    with psycopg.connect(owner_url(api.db).replace("postgres://", "postgresql://", 1)) as c:
        c.execute(
            "UPDATE card SET team_id = NULL WHERE id = ANY(%s)",
            ([free_teamless["id"], held_teamless["id"]],),
        )
        c.execute(
            "UPDATE card SET assignee_id = NULL WHERE id = ANY(%s)",
            ([free["id"], free_teamless["id"]],),
        )

    async def keys(mode: str) -> set[str]:
        board = (await api.call("GET", f"/api/v1/boards/unassigned?mode={mode}", session=m1)).json()
        return {c["key"] for col in board["columns"].values() for c in col}

    everyone = await keys("all")
    assert free["key"] in everyone and free_teamless["key"] in everyone
    assert held["key"] not in everyone and held_teamless["key"] not in everyone
    assert await keys("no_team") == {free_teamless["key"]}


async def test_my_org_board_shows_every_card_of_my_teams_but_only_mine_move(
    make_api: AppFactory,
) -> None:
    """D-130: the Org tab lists every org card of my teams (and any card assigned to me);
    `canMove` stays per card - a teammate's card is there but not mine to move."""
    api = await make_api("t_py_my_org_board")
    api.seed()
    admin, m1, m2 = await api.sign_in("ADMIN"), await api.sign_in("M1"), await api.sign_in("M2")
    member = f"/api/v1/teams/{PLATFORM}/members/{m2.user_id}"
    assert (await api.call("PUT", member, session=admin)).status_code == 204

    async def make(s: Session, title: str, **extra: Any) -> str:
        body = {"title": title, "plane": "org", "teamId": PLATFORM, "state": "ready", **extra}
        res = await api.call("POST", "/api/v1/cards", session=s, json=body)
        assert res.status_code == 201, res.text
        key: str = res.json()["key"]
        return key

    mine = await make(m1, "Mine")
    theirs = await make(m2, "Theirs")
    nobodys = await make(m1, "Nobody's")
    # D-147: a new card is always held; a card nobody holds in Ready is a legacy one.
    import psycopg

    from tests.conftest import owner_url

    with psycopg.connect(owner_url(api.db).replace("postgres://", "postgresql://", 1)) as c:
        c.execute("UPDATE card SET assignee_id = NULL WHERE number = %s", (int(nobodys[2:]),))
    web = (
        await api.call(
            "POST",
            "/api/v1/cards",
            session=admin,
            json={"title": "Web", "plane": "org", "teamId": fixture_id("TEAM_WEB")},
        )
    ).json()["key"]

    async def board(s: Session) -> dict[str, bool]:
        res = await api.call("GET", "/api/v1/boards/my-org", session=s)
        assert res.status_code == 200, res.text
        cols: dict[str, list[dict[str, Any]]] = res.json()["columns"]
        return {c["key"]: c["canMove"] for col in cols.values() for c in col}

    seen = await board(m1)
    assert {mine, theirs, nobodys} <= set(seen) and web not in seen
    assert seen[mine] is True and seen[theirs] is False and seen[nobodys] is False
    assert (await board(m2))[theirs] is True and (await board(m2))[mine] is False
    # An admin is in no team but sees every org card there, and may move each (D-117).
    every = await board(admin)
    assert {mine, theirs, nobodys, web} <= set(every) and all(every[k] for k in (mine, theirs, web))


async def test_a_new_card_has_no_priority_until_one_is_chosen(make_api: AppFactory) -> None:
    """D-134: no priority by default; it can be set, and cleared again; unprioritised cards
    sort after prioritised ones on a board."""
    api = await make_api("t_py_priority_none")
    api.seed()
    m1 = await api.sign_in("M1")
    made = await api.call(
        "POST",
        "/api/v1/cards",
        session=m1,
        json={"title": "No priority", "plane": "org", "teamId": PLATFORM, "state": "ready"},
    )
    assert made.status_code == 201, made.text
    card: dict[str, Any] = made.json()
    assert card["priority"] is None
    urgent = await api.call(
        "POST",
        "/api/v1/cards",
        session=m1,
        json={
            "title": "Urgent",
            "plane": "org",
            "teamId": PLATFORM,
            "state": "ready",
            "priority": 1,
        },
    )
    assert urgent.status_code == 201, urgent.text
    board = (await api.call("GET", "/api/v1/boards/my-org", session=m1)).json()
    ready = [c["key"] for c in board["columns"]["ready"]]
    assert ready.index(urgent.json()["key"]) < ready.index(card["key"])

    path = f"/api/v1/cards/{card['key']}"
    set_two = await api.call("PATCH", path, session=m1, json={"version": 1, "priority": 2})
    assert set_two.status_code == 200, set_two.text
    assert set_two.json()["priority"] == 2
    cleared = await api.call("PATCH", path, session=m1, json={"version": 2, "priority": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["priority"] is None


async def test_my_cards_come_first_in_every_column(make_api: AppFactory) -> None:
    """D-136: within a column my own cards lead, before priority and age."""
    api = await make_api("t_py_mine_first")
    api.seed()
    admin, m1, m2 = await api.sign_in("ADMIN"), await api.sign_in("M1"), await api.sign_in("M2")
    member = f"/api/v1/teams/{PLATFORM}/members/{m2.user_id}"
    assert (await api.call("PUT", member, session=admin)).status_code == 204

    async def make(s: Session, title: str, **extra: Any) -> str:
        body = {"title": title, "plane": "org", "teamId": PLATFORM, "state": "ready", **extra}
        res = await api.call("POST", "/api/v1/cards", session=s, json=body)
        assert res.status_code == 201, res.text
        key: str = res.json()["key"]
        return key

    theirs = await make(m2, "Theirs, urgent and older", priority=1)
    mine = await make(m1, "Mine, no priority")
    for s, first in ((m1, mine), (m2, theirs)):
        res = await api.call("GET", f"/api/v1/boards/teams/{PLATFORM}", session=s)
        assert res.status_code == 200, res.text
        ready = [c["key"] for c in res.json()["columns"]["ready"]]
        assert ready[0] == first, (ready, first)


async def test_show_closed_brings_back_cards_closed_over_14_days_ago(make_api: AppFactory) -> None:
    """Boards keep a delivered card for 14 days; `includeClosed` ("Show closed") shows older."""
    api = await make_api("t_py_show_closed")
    api.seed()
    await api.set_clock("2026-06-01T04:30:00Z")
    m1 = await api.sign_in("M1")
    old = (
        await api.call(
            "POST",
            "/api/v1/cards",
            session=m1,
            json={
                "title": "Done long ago",
                "plane": "org",
                "teamId": PLATFORM,
                "state": "delivered",
            },
        )
    ).json()["key"]
    await api.set_clock("2026-06-21T04:30:00Z")  # 20 days later
    m1 = await api.sign_in("M1")
    recent = (
        await api.call(
            "POST",
            "/api/v1/cards",
            session=m1,
            json={"title": "Done today", "plane": "org", "teamId": PLATFORM, "state": "delivered"},
        )
    ).json()["key"]

    async def delivered(query: str) -> list[str]:
        res = await api.call("GET", f"/api/v1/boards/my-org{query}", session=m1)
        assert res.status_code == 200, res.text
        return [c["key"] for c in res.json()["columns"]["delivered"]]

    assert await delivered("") == [recent]
    assert set(await delivered("?includeClosed=true")) == {old, recent}
