"""D-116 time log (FR-081..086): my week, notes and days off, the team page and who may see it,
no time on private cards, and the Friday reminder / Monday review emails.

Days off are LMS's answer, not something anybody marks here (SUITE-CONTRACT §3.2), so these
tests stand a fake LMS in front of the integration rather than calling an endpoint that no
longer exists.
"""

from datetime import date
from typing import Any

import pytest

from app.integrations import lms_days_off
from app.repositories.timelog_repository import TimeLogRepository
from app.services import timelog_service
from app.workers.notification_worker import time_mails_once
from tests.conftest import Api, AppFactory, Session, assert_problem
from tests.fixtures import fixture_id

PLATFORM = fixture_id("TEAM_PLATFORM")
WEB = fixture_id("TEAM_WEB")
SECRET = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
WEDNESDAY = "2026-06-17T06:30:00Z"  # 12:00 in Asia/Kolkata; the week of Monday 2026-06-15


async def _card(api: Api, s: Session, **body: Any) -> dict[str, Any]:
    res = await api.call("POST", "/api/v1/cards", session=s, json={"title": "t", **body})
    assert res.status_code == 201, res.text
    card: dict[str, Any] = res.json()
    return card


async def _log(api: Api, s: Session, key: str, day: str, hours: float) -> None:
    res = await api.call(
        "POST", f"/api/v1/cards/{key}/time", session=s, json={"date": day, "hours": hours}
    )
    assert res.status_code == 201, res.text


def stub_lms(
    monkeypatch: pytest.MonkeyPatch,
    days: dict[str, tuple[str, str, float]],
    only: list[str] | None = None,
) -> None:
    """Answer as LMS would: {"2026-06-19": ("leave", "Annual Leave", 1.0)}, for everybody or
    only for the Kanban users in `only`.

    Kanban users in these tests have never signed in through the portal, so they carry no
    TT Suite id; the lookup is stubbed too, which also exercises the mapping back from suite
    ids to Kanban ids.
    """

    async def fake_suite_ids(_self: Any, user_ids: list[str]) -> dict[str, str]:
        return {uid: f"suite-{uid}" for uid in user_ids}

    monkeypatch.setattr(TimeLogRepository, "suite_ids", fake_suite_ids)

    async def fake_fetch(
        _base: str, _token: str, suite_user_ids: list[str], start: date, end: date
    ) -> list[lms_days_off.LmsDayOff]:
        wanted = None if only is None else {f"suite-{uid}" for uid in only}
        return [
            lms_days_off.LmsDayOff(
                suite_user_id=suite_id, date=date.fromisoformat(day), kind=kind,
                label=label, portion=portion,
            )
            for suite_id in suite_user_ids
            if wanted is None or suite_id in wanted
            for day, (kind, label, portion) in days.items()
            if start <= date.fromisoformat(day) <= end
        ]

    monkeypatch.setattr(timelog_service.lms_days_off, "fetch", fake_fetch)


async def _setup(make_api: AppFactory, db: str) -> tuple[Api, Session, Session, Session]:
    """M1 is in Platform; M2 is in Web and also a member and the lead of Platform."""
    api = await make_api(db, APP_SECRET=SECRET)
    api.seed()
    await api.set_clock(WEDNESDAY)
    admin, m1, m2 = await api.sign_in("ADMIN"), await api.sign_in("M1"), await api.sign_in("M2")
    path = f"/api/v1/teams/{PLATFORM}/members/{m2.user_id}"
    assert (await api.call("PUT", path, session=admin)).status_code == 204
    api.make_lead(PLATFORM, m2.user_id)
    return api, admin, m1, m2


async def test_my_week_notes_days_off_and_no_private_time(
    make_api: AppFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    api, _admin, m1, _m2 = await _setup(make_api, "t_py_time_me")
    # Friday is approved leave in LMS; nobody marks it here.
    stub_lms(monkeypatch, {"2026-06-19": ("leave", "Annual Leave", 1.0)})
    card = await _card(api, m1, plane="org", teamId=PLATFORM)
    await _log(api, m1, card["key"], "2026-06-15", 8)
    await _log(api, m1, card["key"], "2026-06-16", 6.5)
    await _log(api, m1, card["key"], "2026-06-22", 2)  # next week: not in this one
    # D-116 b: time is logged on org cards only.
    private = await _card(api, m1, plane="private")
    assert_problem(
        await api.call(
            "POST",
            f"/api/v1/cards/{private['key']}/time",
            session=m1,
            json={"date": "2026-06-17", "hours": 1},
        ),
        422,
        "PRIVATE_CARD_TIME",
    )
    listed = (await api.call("GET", f"/api/v1/cards/{private['key']}/time", session=m1)).json()
    assert listed == {"total": 0, "scope": "own", "items": []}
    # A day of leave lowers the target by 8 h, and marking days off by hand no longer exists.
    gone = await api.call(
        "PUT", "/api/v1/me/time/days/2026-06-19/off", session=m1, json={"kind": "leave"}
    )
    assert gone.status_code == 405 or gone.status_code == 404, gone.text
    note = await api.call(
        "PUT", "/api/v1/me/time/weeks/2026-06-15/note", session=m1, json={"note": " client visit "}
    )
    assert note.status_code == 204
    not_monday = await api.call(
        "PUT", "/api/v1/me/time/weeks/2026-06-16/note", session=m1, json={"note": "x"}
    )
    assert assert_problem(not_monday, 422, "VALIDATION_FAILED")["errors"][0]["code"] == (
        "WEEK_START"
    )
    week = (await api.call("GET", "/api/v1/me/time", session=m1)).json()
    assert week["weekStart"] == "2026-06-15"
    assert [d["date"] for d in week["days"]] == [
        "2026-06-15",
        "2026-06-16",
        "2026-06-17",
        "2026-06-18",
        "2026-06-19",
    ]
    assert [d["hours"] for d in week["days"]] == [8, 6.5, 0, 0, 0]
    assert week["days"][4] == {
        "date": "2026-06-19", "hours": 0, "target": 0,
        "dayOff": "leave", "dayOffLabel": "Annual Leave",
    }
    assert (week["total"], week["target"], week["note"]) == (14.5, 32, "client visit")
    assert [e["card"]["key"] for e in week["entries"]] == [card["key"], card["key"]]
    assert week["entries"][0]["card"]["state"] == card["state"]  # D-156: Team time Status
    # Any date picks its week; with no leave on record the week asks for its usual 40 h.
    stub_lms(monkeypatch, {})
    await api.call("PUT", "/api/v1/me/time/weeks/2026-06-15/note", session=m1, json={"note": ""})
    again = (await api.call("GET", "/api/v1/me/time?week=2026-06-18", session=m1)).json()
    assert (again["target"], again["note"]) == (40, "")
    later = (await api.call("GET", "/api/v1/me/time?week=2026-06-24", session=m1)).json()
    assert (later["weekStart"], later["total"]) == ("2026-06-22", 2)


async def test_team_page_shows_own_team_detail_and_other_teams_as_a_figure(
    make_api: AppFactory,
) -> None:
    api, admin, m1, m2 = await _setup(make_api, "t_py_time_team")
    platform = await _card(api, m1, title="Platform work", plane="org", teamId=PLATFORM)
    web = await _card(api, m2, title="Web work", plane="org", teamId=WEB)
    await _log(api, m1, platform["key"], "2026-06-15", 8)
    await _log(api, m2, web["key"], "2026-06-15", 3)
    await api.call(
        "PUT", "/api/v1/me/time/weeks/2026-06-15/note", session=m1, json={"note": "on call"}
    )
    # Teams whose page I may open: a lead's own teams; every team for an admin; none otherwise.
    mine = (await api.call("GET", "/api/v1/time/teams", session=m2)).json()["items"]
    assert [t["id"] for t in mine] == [PLATFORM]
    assert (await api.call("GET", "/api/v1/time/teams", session=m1)).json()["items"] == []
    every = (await api.call("GET", "/api/v1/time/teams", session=admin)).json()["items"]
    assert {t["id"] for t in every} == {PLATFORM, WEB}
    page = (await api.call("GET", f"/api/v1/teams/{PLATFORM}/time", session=m2)).json()
    assert (page["teamName"], page["weekStart"]) == ("Platform", "2026-06-15")
    rows = {r["user"]["name"]: r for r in page["members"]}
    meera, mohan = rows["Meera Member"], rows["Mohan Member"]
    assert (meera["total"], meera["target"], meera["shortBy"], meera["note"]) == (
        8,
        40,
        32,
        "on call",
    )
    assert [e["card"]["title"] for e in meera["entries"]] == ["Platform work"]
    # D-116 a: Mohan's Web hours count toward his total but show here only as a figure.
    assert (mohan["isLead"], mohan["total"], mohan["otherTeamsHours"]) == (True, 3, 3)
    assert mohan["entries"] == [] and "Web work" not in str(page)
    # Not a lead of Web, not a lead at all: refused. Admins may open any team.
    assert_problem(await api.call("GET", f"/api/v1/teams/{WEB}/time", session=m2), 403, "FORBIDDEN")
    assert_problem(
        await api.call("GET", f"/api/v1/teams/{PLATFORM}/time", session=m1), 403, "FORBIDDEN"
    )
    web_page = (await api.call("GET", f"/api/v1/teams/{WEB}/time", session=admin)).json()
    assert [e["card"]["title"] for e in web_page["members"][0]["entries"]] == ["Web work"]
    assert_problem(
        await api.call("GET", f"/api/v1/teams/{'0' * 26}/time", session=admin),
        404,
        "NOT_FOUND",
    )


async def test_friday_reminder_then_monday_review_mail_members_and_leads(
    make_api: AppFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    api, _admin, m1, m2 = await _setup(make_api, "t_py_time_mail")
    # Only Meera is off that Friday; Mohan's week still asks for its full 40 h.
    stub_lms(monkeypatch, {"2026-06-19": ("holiday", "Company holiday", 1.0)}, only=[m1.user_id])
    platform = await _card(api, m1, plane="org", teamId=PLATFORM)
    await _log(api, m1, platform["key"], "2026-06-15", 8)
    await _log(api, m1, platform["key"], "2026-06-16", 8)
    await api.call(
        "PUT", "/api/v1/me/time/weeks/2026-06-15/note", session=m1, json={"note": "migration"}
    )

    async def run(job: str) -> dict[str, Any]:
        res = await api.call("POST", f"/api/v1/dev/time-mails/run?job={job}")
        assert res.status_code == 200, res.text
        body: dict[str, Any] = res.json()
        return body

    async def kinds() -> list[tuple[str, str]]:
        items = (await api.call("GET", "/api/v1/dev/notifications")).json()["items"]
        return sorted((n["kind"], n["targetId"]) for n in items)

    # A review never comes before that week's reminder (D-116 h).
    await api.set_clock("2026-06-22T05:00:00Z")
    assert (await run("monday_review"))["ran"] is False
    # Friday 17:30 India time: the worker queues the reminder once.
    await api.set_clock("2026-06-19T12:00:00Z")
    await time_mails_once(api.app)
    await time_mails_once(api.app)  # a second tick sends nothing new (FR-086)
    assert await kinds() == sorted([("time_reminder", m1.user_id), ("time_reminder", m2.user_id)])
    assert (await run("friday_reminder"))["ran"] is False
    # Monday 10:30: last week is reviewed - member mails, the Platform lead told about Meera
    # (Mohan is short too, but he is the only Platform lead and Web has none), one report.
    await api.set_clock("2026-06-22T05:00:00Z")
    await time_mails_once(api.app)
    assert await kinds() == sorted(
        [
            ("time_reminder", m1.user_id),
            ("time_reminder", m2.user_id),
            ("time_shortfall", m1.user_id),
            ("time_shortfall", m2.user_id),
            ("time_shortfall_lead", m2.user_id),
            ("time_team_report", m2.user_id),
        ]
    )
    assert (await run("monday_review"))["ran"] is False
    drained = (await api.call("POST", "/api/v1/dev/notifications/run")).json()
    assert drained == {"sent": 6, "failed": 0}
    mail = {
        (m["to"], m["subject"]): m["body"]
        for m in (await api.call("GET", "/api/v1/dev/mail")).json()["items"]
    }
    lead_mail = mail[("m2@example.test", "[Kanban] Meera Member logged 16 of 32 h last week")]
    assert "16 h short" in lead_mail and "Their note: migration" in lead_mail
    report = mail[("m2@example.test", "[Kanban] Weekly time report: Platform, week of 2026-06-15")]
    assert "- Meera Member: 16 of 32 h, short by 16 h - migration" in report
    assert "- Mohan Member: 0 of 40 h, short by 40 h" in report
    assert ("m1@example.test", "[Kanban] Your time this week: 16 of 32 h") in mail


async def test_month_view_covers_every_working_day(
    make_api: AppFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D-120: `month=YYYY-MM` returns the whole calendar month, its working days and target."""
    api, _admin, m1, m2 = await _setup(make_api, "t_py_time_month")
    card = await _card(api, m1, plane="org", teamId=PLATFORM)
    await _log(api, m1, card["key"], "2026-06-01", 8)  # first week
    await _log(api, m1, card["key"], "2026-06-30", 4)  # last day of the month
    await _log(api, m1, card["key"], "2026-07-01", 8)  # next month: not counted
    stub_lms(monkeypatch, {"2026-06-12": ("holiday", "Company holiday", 1.0)})
    month = (await api.call("GET", "/api/v1/me/time?month=2026-06", session=m1)).json()
    assert (month["period"], month["start"], month["end"]) == ("month", "2026-06-01", "2026-06-30")
    assert len(month["days"]) == 22  # June 2026 has 22 working days
    assert (month["total"], month["target"], month["note"]) == (12, 21 * 8, "")
    assert [e["date"] for e in month["entries"]] == ["2026-06-01", "2026-06-30"]
    week = (await api.call("GET", "/api/v1/me/time", session=m1)).json()
    assert (week["period"], week["start"], week["end"]) == ("week", "2026-06-15", "2026-06-19")
    assert_problem(
        await api.call("GET", "/api/v1/me/time?month=2026-13", session=m1),
        422,
        "VALIDATION_FAILED",
    )
    team = (
        await api.call("GET", f"/api/v1/teams/{PLATFORM}/time?month=2026-06", session=m2)
    ).json()
    meera = next(r for r in team["members"] if r["user"]["name"] == "Meera Member")
    assert (team["period"], len(meera["days"]), meera["total"]) == ("month", 22, 12)


async def test_time_is_logged_by_the_assignee_a_lead_or_an_admin(make_api: AppFactory) -> None:
    """D-138: like moving (D-117) - a teammate cannot book hours on someone else's card, nor on
    one nobody holds; the card's team lead and admins can."""
    api = await make_api("t_py_time_who", APP_SECRET=SECRET)
    api.seed()
    await api.set_clock(WEDNESDAY)
    admin, m1, m2 = await api.sign_in("ADMIN"), await api.sign_in("M1"), await api.sign_in("M2")
    member = f"/api/v1/teams/{PLATFORM}/members/{m2.user_id}"
    assert (await api.call("PUT", member, session=admin)).status_code == 204  # M2: plain member
    mine = await _card(api, m1, plane="org", teamId=PLATFORM)
    # D-147: a new card is always held; releasing it is what leaves nobody holding it.
    held = await _card(api, m1, plane="org", teamId=PLATFORM)
    released = await api.call(
        "PATCH",
        f"/api/v1/cards/{held['key']}",
        session=m1,
        json={"version": held["version"], "assigneeId": None},
    )
    nobodys: dict[str, Any] = released.json()
    assert nobodys["assigneeId"] is None

    async def log(s: Session, key: str) -> Any:
        return await api.call(
            "POST", f"/api/v1/cards/{key}/time", session=s, json={"date": "2026-06-16", "hours": 1}
        )

    assert (await log(m1, mine["key"])).status_code == 201  # the assignee
    assert_problem(await log(m2, mine["key"]), 403, "FORBIDDEN")  # a teammate
    assert_problem(await log(m1, nobodys["key"]), 403, "FORBIDDEN")  # claim it first
    assert (await log(admin, mine["key"])).status_code == 201  # an admin
    api.make_lead(PLATFORM, m2.user_id)
    assert (await log(m2, mine["key"])).status_code == 201  # the team's lead
    assert (await log(m2, nobodys["key"])).status_code == 201


async def test_team_time_csv_for_leads_and_admins_and_in_the_monday_report(
    make_api: AppFactory,
) -> None:
    """D-140: the Team time page as CSV - the team's lead and admins only - and the same file
    attached to the Monday team report sent to each lead."""
    api, admin, m1, m2 = await _setup(make_api, "t_py_time_csv")  # M2 leads Platform
    card = await _card(api, m1, plane="org", teamId=PLATFORM, title="UPI checkout")
    await _log(api, m1, card["key"], "2026-06-15", 6.5)
    url = f"/api/v1/teams/{PLATFORM}/time.csv?week=2026-06-15"

    res = await api.call("GET", url, session=m2)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/csv")
    assert 'filename="time-platform-2026-06-15.csv"' in res.headers["content-disposition"]
    body = res.text
    assert body.startswith("\ufeff")  # Excel reads it as UTF-8
    assert f'"2026-06-15","Meera Member","{card["key"]}","UPI checkout","6.5"' in body
    assert '"Person","Lead","Hours (all teams)"' in body
    assert (await api.call("GET", url, session=admin)).status_code == 200
    assert_problem(await api.call("GET", url, session=m1), 403, "FORBIDDEN")  # not a lead

    # Friday's reminder, then Monday 10:30's review: the lead's team report carries the CSV.
    await api.set_clock("2026-06-19T12:00:00Z")
    await time_mails_once(api.app)
    await api.set_clock("2026-06-22T05:00:00Z")
    await time_mails_once(api.app)
    items = (await api.call("GET", "/api/v1/dev/notifications")).json()["items"]
    report = next(n for n in items if n["kind"] == "time_team_report")
    assert report["payload"]["attachment"]["filename"] == "time-platform-2026-06-15.csv"
    assert card["key"] in report["payload"]["attachment"]["content"]
    await api.call("POST", "/api/v1/dev/notifications/run")
    mails = (await api.call("GET", "/api/v1/dev/mail")).json()["items"]
    sent = next(m for m in mails if "Weekly time report" in m["subject"])
    assert "[attached: time-platform-2026-06-15.csv]" in sent["body"]
