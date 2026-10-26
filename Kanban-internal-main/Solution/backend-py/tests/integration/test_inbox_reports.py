"""M4: inbox (D-066, CR-14/15/16/19), reports (D-072, CR-13), effort CSV, notification outbox
and sending (D-073/074/075)."""

import csv
import io
import smtplib
from typing import Any, ClassVar

import pytest

from tests.conftest import Api, AppFactory, Session, assert_problem
from tests.fixtures import fixture_id

PLATFORM = fixture_id("TEAM_PLATFORM")
SECRET = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="


async def _api(make_api: AppFactory, db: str) -> tuple[Api, Session, Session, Session]:
    api = await make_api(db, APP_SECRET=SECRET)
    api.seed()
    await api.set_clock("2026-06-15T04:30:00Z")
    return api, await api.sign_in("ADMIN"), await api.sign_in("M1"), await api.sign_in("M2")


async def _card(api: Api, s: Session, **body: Any) -> dict[str, Any]:
    res = await api.call("POST", "/api/v1/cards", session=s, json={"title": "t", **body})
    assert res.status_code == 201, res.text
    card: dict[str, Any] = res.json()
    return card


async def test_inbox_groups_unread_read_seen_and_clear(make_api: AppFactory) -> None:
    api, admin, m1, m2 = await _api(make_api, "t_py_inbox")
    card = await _card(api, m1, title="Mine", plane="org")
    key = card["key"]
    # The admin assigns it away and back, comments, and moves it: four groups for M1.
    await api.call(
        "PATCH", f"/api/v1/cards/{key}", session=admin, json={"version": 1, "priority": 1}
    )
    await api.call("POST", f"/api/v1/cards/{key}/comments", session=admin, json={"body": "ping"})
    await api.call(
        "POST", f"/api/v1/cards/{key}/move", session=admin, json={"state": "ready", "version": 3}
    )
    page = (await api.call("GET", "/api/v1/inbox", session=m1)).json()
    fields = [i["event"]["field"] for i in page["items"]]
    assert fields == ["state", "comment_added", "priority"]  # newest first; my own events excluded
    assert page["total"] == 3 and page["unread"] == 3
    totals = {g["group"]: g["total"] for g in page["groups"]}
    assert [g["group"] for g in page["groups"]] == [
        "assignments",
        "mentions",  # D-158
        "status_changes",
        "priority_eta",
        "reassignments",
        "comments",
        "other",
    ]
    assert (totals["status_changes"], totals["comments"], totals["priority_eta"]) == (1, 1, 1)
    first = page["items"][0]
    assert first["card"]["key"] == key and first["reason"] == "mine" and first["unread"] is True
    assert set(first["event"]["actor"]) == {"id", "name", "email", "role"}
    # Filter by group; mark one read; the badge on /me follows.
    only = (await api.call("GET", "/api/v1/inbox?group=comments", session=m1)).json()
    assert [i["event"]["field"] for i in only["items"]] == ["comment_added"]
    assert only["groups"] == page["groups"]  # totals are over the whole filtered set
    read = await api.call(
        "POST", "/api/v1/inbox/read", session=m1, json={"eventIds": [first["event"]["id"]]}
    )
    assert read.status_code == 204
    assert (await api.call("GET", "/api/v1/me", session=m1)).json()["inboxUnread"] == 2
    # Somebody else's id is skipped, not refused.
    other = await api.call(
        "POST", "/api/v1/inbox/read", session=m2, json={"eventIds": [first["event"]["id"]]}
    )
    assert other.status_code == 204
    assert (await api.call("POST", "/api/v1/inbox/seen", session=m1)).status_code == 204
    assert (await api.call("GET", "/api/v1/inbox", session=m1)).json()["unread"] == 0
    cleared = await api.call(
        "POST", "/api/v1/inbox/clear", session=m1, json={"before": "2026-06-15T23:59:59Z"}
    )
    assert cleared.status_code == 204
    assert (await api.call("GET", "/api/v1/inbox", session=m1)).json()["total"] == 0
    # M2 (another team) never sees the Platform card's events (CR-14).
    assert (await api.call("GET", "/api/v1/inbox", session=m2)).json()["total"] == 0
    assert_problem(
        await api.call("POST", "/api/v1/inbox/read", session=m1, json={"eventIds": []}),
        422,
        "VALIDATION_FAILED",
    )


async def test_reports_progress_overdue_and_effort_csv(make_api: AppFactory) -> None:
    api, admin, m1, m2 = await _api(make_api, "t_py_reports")
    project = (
        await api.call(
            "POST", "/api/v1/projects", session=admin, json={"name": "Rep", "teamId": PLATFORM}
        )
    ).json()
    late = await _card(
        api,
        m1,
        title="=SUM(A1)",
        plane="org",
        projectId=project["id"],
        eta="2026-06-10",
        effortHours=4,
    )
    await _card(api, m1, title="no eta", plane="org", projectId=project["id"])
    done = await _card(
        api, m1, title="done", plane="org", projectId=project["id"], state="delivered"
    )
    await api.call(
        "POST",
        f"/api/v1/cards/{late['key']}/time",
        session=m1,
        json={"date": "2026-06-14", "hours": 2},
    )
    await api.call(
        "POST",
        f"/api/v1/cards/{late['key']}/time",
        session=admin,
        json={"date": "2026-06-14", "hours": 1.5},
    )
    progress = (
        await api.call("GET", "/api/v1/reports/progress?groupBy=project", session=m1)
    ).json()
    assert progress["today"] == "2026-06-15"
    row = next(r for r in progress["rows"] if r["id"] == project["id"])
    assert (row["open"], row["delivered"], row["cancelled"]) == (2, 1, 0)
    assert (row["noEta"], row["overdue"], row["effortHours"]) == (1, 1, 4)
    assert row["loggedHours"] == 2  # CR-13: a member's own hours only
    # D-146: Testing is now UAT (D-112 had removed the old UAT).
    assert row["byState"]["backlog"] == 2 and row["byState"]["uat"] == 0
    assert "testing" not in row["byState"]
    admin_row = next(
        r
        for r in (
            await api.call("GET", "/api/v1/reports/progress?groupBy=project", session=admin)
        ).json()["rows"]
        if r["id"] == project["id"]
    )
    assert admin_row["loggedHours"] == 3.5
    # M2 is not in Platform: the team's cards are out of their scope.
    assert all(
        r["id"] != project["id"]
        for r in (
            await api.call("GET", "/api/v1/reports/progress?groupBy=project", session=m2)
        ).json()["rows"]
    )
    overdue = (await api.call("GET", "/api/v1/reports/overdue?groupBy=team", session=m1)).json()
    assert [g["name"] for g in overdue["groups"]] == ["Platform"]
    assert [c["key"] for c in overdue["groups"][0]["cards"]] == [late["key"]]
    assert done["key"] not in str(overdue)
    res = await api.call(
        "GET", "/api/v1/reports/effort.csv?from=2026-06-01&to=2026-06-30", session=admin
    )
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    assert res.headers["content-disposition"] == 'attachment; filename="effort-2026-06-15.csv"'
    assert res.text.endswith("\r\n") and res.text.startswith('"Team","Project","Card"')
    rows = list(csv.reader(io.StringIO(res.text)))
    assert rows[1][3] == "'=SUM(A1)"  # spreadsheet formula neutralised
    assert sorted(r[8] for r in rows[1:]) == ["1.5", "2"]
    backwards = await api.call(
        "GET", "/api/v1/reports/effort.csv?from=2026-06-30&to=2026-06-01", session=admin
    )
    assert assert_problem(backwards, 422, "VALIDATION_FAILED")["errors"][0]["code"] == "RANGE"
    assert_problem(
        await api.call("GET", "/api/v1/reports/progress", session=m1), 422, "VALIDATION_FAILED"
    )


async def test_outbox_rows_send_to_stub_mail_and_teams_failures_retry(
    make_api: AppFactory,
) -> None:
    api, admin, m1, _m2 = await _api(make_api, "t_py_notify")
    # M1 opts into email; Platform gets a Teams webhook that will fail (nothing listens).
    await api.call("PATCH", "/api/v1/me/preferences", session=m1, json={"notifyEmail": True})
    await api.call(
        "PATCH",
        f"/api/v1/teams/{PLATFORM}",
        session=admin,
        json={"teamsWebhookUrl": "https://127.0.0.1:9/hook"},
    )
    card = await _card(
        api, admin, title="For you", plane="org", teamId=PLATFORM, assigneeId=m1.user_id
    )
    outbox = (await api.call("GET", "/api/v1/dev/notifications")).json()["items"]
    assert sorted((n["channel"], n["kind"]) for n in outbox) == [
        ("email", "assigned"),
        ("teams", "assigned"),
    ]
    run = (await api.call("POST", "/api/v1/dev/notifications/run")).json()
    assert run == {"sent": 1, "failed": 1}
    mail = (await api.call("GET", "/api/v1/dev/mail")).json()["items"]
    assert mail[0]["to"] == "m1@example.test"
    assert mail[0]["subject"] == f"[Kanban] You were assigned: {card['key']}"
    assert "Asha Admin: assigned to you" in mail[0]["body"]
    teams = next(
        n
        for n in (await api.call("GET", "/api/v1/dev/notifications")).json()["items"]
        if n["channel"] == "teams"
    )
    assert teams["attempts"] == 1 and teams["sentAt"] is None and teams["lastError"]
    # Retried up to three attempts, then left alone.
    for _ in range(3):
        await api.call("POST", "/api/v1/dev/notifications/run")
    teams = next(
        n
        for n in (await api.call("GET", "/api/v1/dev/notifications")).json()["items"]
        if n["channel"] == "teams"
    )
    assert teams["attempts"] == 3


async def test_assignment_mail_goes_out_without_opt_in(make_api: AppFactory) -> None:
    """D-123: the person hears about work handed to them whatever their email preference;
    assigning to yourself (or claiming) sends nothing."""
    api, admin, m1, _m2 = await _api(make_api, "t_py_assign_mail")
    prefs = (await api.call("GET", "/api/v1/me/preferences", session=m1)).json()
    assert prefs["notifyEmail"] is False
    await _card(
        api, admin, title="Handed over", plane="org", teamId=PLATFORM, assigneeId=m1.user_id
    )
    await _card(api, m1, title="My own", plane="org", teamId=PLATFORM)
    outbox = (await api.call("GET", "/api/v1/dev/notifications")).json()["items"]
    assert [(n["channel"], n["kind"], n["targetId"]) for n in outbox] == [
        ("email", "assigned", m1.user_id)
    ]


async def test_contact_admin_mails_every_admin_and_is_rate_limited(make_api: AppFactory) -> None:
    """D-125: someone who cannot sign in writes to the admins without a session; each active
    admin gets it by email (escaped in the HTML), bad input is refused, the IP is limited."""
    api = await make_api("t_py_contact_admin", APP_SECRET=SECRET, RL_CONTACT_IP="2/hour")
    api.seed()
    body = {
        "name": "Neha Kapoor",
        "email": "neha.kapoor@example.test",
        "message": "Not invited <b>",
    }
    res = await api.call("POST", "/api/v1/auth/contact-admin", json=body)
    assert res.status_code == 204, res.text
    outbox = (await api.call("GET", "/api/v1/dev/notifications")).json()["items"]
    assert [(n["channel"], n["kind"], n["targetId"]) for n in outbox] == [
        ("email", "contact_admin", fixture_id("ADMIN"))
    ]
    await api.call("POST", "/api/v1/dev/notifications/run")
    mail = (await api.call("GET", "/api/v1/dev/mail")).json()["items"][0]
    assert mail["subject"] == "[Kanban] Message from someone who cannot sign in: Neha Kapoor"
    assert "neha.kapoor@example.test" in mail["body"] and "Not invited <b>" in mail["body"]

    bad = await api.call("POST", "/api/v1/auth/contact-admin", json={**body, "email": "nope"})
    assert_problem(bad, 422, "VALIDATION_FAILED")
    assert_problem(
        await api.call("POST", "/api/v1/auth/contact-admin", json=body), 429, "RATE_LIMITED"
    )

    # D-144: the message is also kept for Administration > Login issues - admins only.
    admin = await api.sign_in("ADMIN")
    base = "/api/v1/admin/login-issues"
    assert (await api.call("GET", base, session=await api.sign_in("M1"))).status_code == 403
    listed = (await api.call("GET", base, session=admin)).json()
    assert listed["open"] == 1
    issue = listed["items"][0]
    assert (issue["name"], issue["email"], issue["message"]) == (
        "Neha Kapoor",
        "neha.kapoor@example.test",
        "Not invited <b>",
    )
    assert issue["resolvedAt"] is None and issue["resolvedByName"] is None
    done = (await api.call("POST", f"{base}/{issue['id']}/resolve", session=admin)).json()
    assert done["open"] == 0
    assert done["items"][0]["resolvedByName"] == "Asha Admin"
    assert done["items"][0]["resolvedAt"] is not None
    missing = await api.call("POST", f"{base}/{'0' * 26}/resolve", session=admin)
    assert_problem(missing, 404, "NOT_FOUND")


class _FakeSmtp:
    """Stands in for smtplib.SMTP: records what would be sent; `fail` makes login refuse."""

    sent: ClassVar[list[Any]] = []
    fail: ClassVar[bool] = False

    def __init__(self, host: str, port: int, timeout: float) -> None:
        self.host, self.port = host, port

    def __enter__(self) -> "_FakeSmtp":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def starttls(self, context: Any = None) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        if _FakeSmtp.fail:
            raise smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")

    def send_message(self, msg: Any) -> None:
        _FakeSmtp.sent.append(msg)


async def test_smtp_sends_html_mail_and_records_the_server_refusal(
    make_api: AppFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D-132: MAIL_PROVIDER=smtp - an assignment goes out as one SMTP message (plain + HTML,
    From the configured name); a refusal is kept on the row with the server's reason."""
    monkeypatch.setattr(smtplib, "SMTP", _FakeSmtp)
    _FakeSmtp.sent, _FakeSmtp.fail = [], False
    api = await make_api(
        "t_py_smtp",
        APP_SECRET=SECRET,
        MAIL_PROVIDER="smtp",
        MAIL_HOST="smtp.example.test",
        MAIL_USERNAME="kanban@example.test",
        MAIL_PASSWORD="pw",
    )
    api.seed()
    admin, m1 = await api.sign_in("ADMIN"), await api.sign_in("M1")
    card = await _card(
        api, admin, title="Over SMTP", plane="org", teamId=PLATFORM, assigneeId=m1.user_id
    )
    run = (await api.call("POST", "/api/v1/dev/notifications/run")).json()
    assert run == {"sent": 1, "failed": 0}
    msg = _FakeSmtp.sent[0]
    assert msg["To"] == "m1@example.test"
    assert msg["Subject"] == f"[Kanban] You were assigned: {card['key']}"
    assert msg["From"] == "Tektalis Kanban <kanban@example.test>"
    assert msg.get_body(preferencelist=("html",)) is not None

    _FakeSmtp.fail = True
    await _card(api, admin, title="Refused", plane="org", teamId=PLATFORM, assigneeId=m1.user_id)
    assert (await api.call("POST", "/api/v1/dev/notifications/run")).json()["failed"] == 1
    row = next(
        n
        for n in (await api.call("GET", "/api/v1/dev/notifications")).json()["items"]
        if n["lastError"]
    )
    assert row["lastError"].startswith("smtp 535") and "not accepted" in row["lastError"]


async def test_admins_edit_email_wording_and_the_mails_use_it(make_api: AppFactory) -> None:
    """D-141: Administration > Email templates - admins only; a typo'd placeholder is refused;
    preview fills sample values; a saved text is what the next mail says; reset restores."""
    api, admin, m1, _m2 = await _api(make_api, "t_py_mail_templates")
    base = "/api/v1/admin/mail-templates"
    assert (await api.call("GET", base, session=m1)).status_code == 403
    listed = (await api.call("GET", base, session=admin)).json()["items"]
    assigned = next(t for t in listed if t["kind"] == "assigned")
    assert assigned["edited"] is False and "{cardKey}" in assigned["subject"]
    assert "cardTitle" in assigned["placeholders"]

    typo = {"subject": "Task {cardKey}", "body": "Hello {cardTitel}"}
    res = await api.call("PUT", f"{base}/assigned", session=admin, json=typo)
    assert (
        assert_problem(res, 422, "VALIDATION_FAILED")["errors"][0]["code"] == "UNKNOWN_PLACEHOLDER"
    )

    mine = {
        "subject": "New task {cardKey}: {cardTitle}",
        "body": "Hi,\n\n{actorName} gave you {cardKey}.",
    }
    preview = (await api.call("POST", f"{base}/assigned/preview", session=admin, json=mine)).json()
    assert preview["subject"] == "New task K-42: Integrate UPI collect API"
    assert "Anita Rao gave you K-42." in preview["text"] and "<p>Hi,</p>" in preview["html"]
    saved = await api.call("PUT", f"{base}/assigned", session=admin, json=mine)
    assert saved.status_code == 200, saved.text

    card = await _card(
        api, admin, title="Report bug", plane="org", teamId=PLATFORM, assigneeId=m1.user_id
    )
    await api.call("POST", "/api/v1/dev/notifications/run")
    mail = (await api.call("GET", "/api/v1/dev/mail")).json()["items"][0]
    assert mail["subject"] == f"New task {card['key']}: Report bug"
    assert mail["body"] == f"Hi,\n\nAsha Admin gave you {card['key']}."

    reset = (await api.call("DELETE", f"{base}/assigned", session=admin)).json()["items"]
    assert next(t for t in reset if t["kind"] == "assigned")["edited"] is False


async def test_progress_report_for_a_period(make_api: AppFactory) -> None:
    """D-153: a period counts the cards created or closed in it and the hours logged in it;
    without one, everything as before. The clock is 15 Jun 2026."""
    api, admin, m1, _m2 = await _api(make_api, "t_py_reports_period")
    project = (
        await api.call(
            "POST", "/api/v1/projects", session=admin, json={"name": "Per", "teamId": PLATFORM}
        )
    ).json()
    card = await _card(api, m1, title="june", plane="org", projectId=project["id"])
    for day in ("2026-05-29", "2026-06-02"):
        await api.call(
            "POST",
            f"/api/v1/cards/{card['key']}/time",
            session=m1,
            json={"date": day, "hours": 2},
        )

    async def row(query: str) -> dict[str, Any] | None:
        res = await api.call("GET", f"/api/v1/reports/progress?groupBy=project{query}", session=m1)
        assert res.status_code == 200, res.text
        return next((r for r in res.json()["rows"] if r["id"] == project["id"]), None)

    june = await row("&from=2026-06-01&to=2026-06-30")
    assert june is not None and june["open"] == 1 and june["loggedHours"] == 2
    assert await row("&from=2026-04-01&to=2026-04-30") is None  # not created or closed then
    everything = await row("")
    assert everything is not None and everything["loggedHours"] == 4
    half = await api.call(
        "GET", "/api/v1/reports/progress?groupBy=project&from=2026-06-01", session=m1
    )
    assert_problem(half, 422, "VALIDATION_FAILED")
    backwards = await api.call(
        "GET",
        "/api/v1/reports/progress?groupBy=project&from=2026-06-30&to=2026-06-01",
        session=m1,
    )
    assert_problem(backwards, 422, "VALIDATION_FAILED")


async def test_mentions_reach_only_people_who_may_read_the_card(make_api: AppFactory) -> None:
    """D-158: a comment's @[Name](user:id) puts it under Mentions for that person - when they may
    read the card (CR-14). Another team's member gets nothing; a team-less card reaches anyone;
    an edit that adds a mention counts, one that keeps it does not."""
    import psycopg

    from tests.conftest import owner_url

    api, admin, m1, m2 = await _api(make_api, "t_py_mentions")
    card = await _card(api, admin, title="Platform work", plane="org", teamId=PLATFORM)
    key = card["key"]
    meera = f"@[Meera Member](user:{m1.user_id})"
    mohan = f"@[Mohan Member](user:{m2.user_id})"
    body = {"body": f"{meera} and {mohan}, please look"}
    await api.call("POST", f"/api/v1/cards/{key}/comments", session=admin, json=body)

    mentions = (await api.call("GET", "/api/v1/inbox?group=mentions", session=m1)).json()
    assert [i["reason"] for i in mentions["items"]] == ["mentioned"]
    assert mentions["items"][0]["group"] == "mentions"
    # Mohan is in another team: the mention shows him nothing.
    assert (await api.call("GET", "/api/v1/inbox", session=m2)).json()["total"] == 0

    # A team-less (legacy) card reaches anyone it names, through an edit that adds the mention.
    loose = await _card(api, admin, title="Loose", plane="org", teamId=PLATFORM)
    with psycopg.connect(owner_url(api.db).replace("postgres://", "postgresql://", 1)) as c:
        c.execute("UPDATE card SET team_id = NULL WHERE id = %s", (loose["id"],))
    made = await api.call(
        "POST", f"/api/v1/cards/{loose['key']}/comments", session=admin, json={"body": "hi"}
    )
    comment_id = made.json()["id"]
    path = f"/api/v1/cards/{loose['key']}/comments/{comment_id}"
    await api.call("PATCH", path, session=admin, json={"body": f"hi {mohan}"})
    await api.call("PATCH", path, session=admin, json={"body": f"hi {mohan}!"})  # still mentioned
    mine = (await api.call("GET", "/api/v1/inbox?group=mentions", session=m2)).json()
    assert [i["event"]["field"] for i in mine["items"]] == ["comment_edited"]
    assert mine["items"][0]["card"]["key"] == loose["key"]
