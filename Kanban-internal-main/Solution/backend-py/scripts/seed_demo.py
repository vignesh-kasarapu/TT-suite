"""Demo data for dev and the LAN trial: people, teams with leads, a program with projects, tags,
and cards across the board with comments, links, and two finished weeks plus this week of logged
time with days off and week notes (D-116), so My time and Team time have something to show.

    .venv/Scripts/python -m scripts.seed_demo        (from Solution/backend-py; reads .env)

It goes through the API in-process, signed in as each person, so every rule applies and every
card change writes its events. It only adds - nothing is deleted or rewritten - and it stops if
the demo team already exists. Refused in prod.
"""

import asyncio
import sys
from datetime import date, timedelta
from typing import Any

import httpx

from app.core.config import load_settings
from app.core.database import UnitOfWork
from app.main import create_app
from app.repositories.suite_repository import SuiteRepository
from app.repositories.user_repository import UserRepository
from app.services.system_service import SeedService

ADMIN_EMAIL = "admin@example.test"
MARKER_TEAM = "Platform Engineering"
XHR = {"x-requested-with": "XHR"}

TEAMS = {
    "platform": ("Platform Engineering", "APIs, data and the services behind every screen."),
    "web": ("Web Experience", "The customer portal and the internal web tools."),
    "mobile": ("Mobile Apps", "iOS and Android apps."),
}
PEOPLE = [
    # key, name, email, teams, lead of
    ("priya", "Priya Sharma", "priya.sharma@example.test", ["platform"], "platform"),
    ("arjun", "Arjun Mehta", "arjun.mehta@example.test", ["platform"], None),
    ("kavya", "Kavya Iyer", "kavya.iyer@example.test", ["platform", "web"], None),
    ("rahul", "Rahul Nair", "rahul.nair@example.test", ["web"], "web"),
    ("sneha", "Sneha Reddy", "sneha.reddy@example.test", ["web"], None),
    ("ananya", "Ananya Das", "ananya.das@example.test", ["mobile"], "mobile"),
    ("vikram", "Vikram Rao", "vikram.rao@example.test", ["mobile", "platform"], None),
]
TAGS = ["billing", "accounts", "forms", "feedback", "bug", "ux", "infra", "security"]

# D-116: hours per working day (Mon..Fri) last week, an optional day off (0-4) and the week note.
# Two weeks ago everyone logged a full week; this week runs to today (today itself is half done).
# A mix on purpose: on target, short with a reason, short with none, leave lowering the target.
LAST_WEEK: dict[str, tuple[list[float], int | None, str]] = {
    "priya": ([8, 8, 8, 8, 8], None, ""),
    "arjun": ([8, 8, 8, 4, 8], None, "Doctor's appointment on Thursday afternoon."),
    "kavya": ([8, 8, 8, 8, 8], None, ""),
    "rahul": ([8, 7.5, 8, 6, 7.5], None, "Hiring interviews on Tuesday and Thursday."),
    "sneha": ([8, 8, 8, 8, 0], 4, "On leave Friday."),
    "ananya": ([8, 8, 8, 8, 8], None, ""),
    "vikram": ([6, 6, 5, 6, 5], None, ""),
}
TIME_NOTES = ["Implementation", "Code review", "Testing", "Design review", "Bug fixing", "Pairing"]

# title, team, project, state, priority, tags, assignee, eta offset (days) or None, effort
CARDS: list[tuple[str, str, str | None, str, int, list[str], str, int | None, float | None]] = [
    (
        "Optimize experience for mobile web",
        "web",
        "billing",
        "backlog",
        2,
        ["billing", "ux"],
        "sneha",
        21,
        8,
    ),
    (
        "Onboard workout options (OWO)",
        "platform",
        "accounts",
        "backlog",
        3,
        ["accounts"],
        "arjun",
        None,
        None,
    ),
    (
        "Multi-dest search UI for mobile web",
        "web",
        None,
        "in_prep",
        2,
        ["accounts", "ux"],
        "kavya",
        14,
        5,
    ),
    (
        "Billing system integration - frontend",
        "web",
        "billing",
        "ready",
        1,
        ["forms", "billing"],
        "rahul",
        10,
        13,
    ),
    ("Fast trip search", "platform", "accounts", "in_development", 2, ["accounts"], "priya", 7, 8),
    (
        "Affiliate links integration - frontend",
        "web",
        "billing",
        "in_development",
        3,
        ["billing"],
        "sneha",
        12,
        5,
    ),
    (
        "Shopping cart purchasing error - quick fix",
        "mobile",
        "checkout",
        "in_development",
        1,
        ["forms", "bug"],
        "ananya",
        2,
        3,
    ),
    (
        "Revise and streamline booking flow",
        "platform",
        "accounts",
        "uat",
        2,
        ["accounts"],
        "kavya",
        5,
        8,
    ),
    (
        "Travel suggestion experiments",
        "platform",
        None,
        "uat",
        3,
        ["accounts", "feedback"],
        "arjun",
        9,
        5,
    ),
    (
        "Ongoing customer satisfaction survey",
        "web",
        None,
        "uat",
        4,
        ["feedback"],
        "rahul",
        None,
        2,
    ),
    (
        "Planet Taxi device exploration & research",
        "mobile",
        None,
        "ready",
        3,
        ["feedback"],
        "vikram",
        30,
        13,
    ),
    (
        "High outage: web-store app crashing",
        "platform",
        "accounts",
        "delivered",
        1,
        ["billing", "bug"],
        "priya",
        -3,
        5,
    ),
    (
        "Web-store purchasing performance fix",
        "mobile",
        "checkout",
        "delivered",
        2,
        ["forms"],
        "vikram",
        -1,
        3,
    ),
    (
        "Rotate payment gateway API keys",
        "platform",
        None,
        "backlog",
        2,
        ["security", "infra"],
        "arjun",
        18,
        2,
    ),
    (
        "Saved cards: tokenise on device",
        "mobile",
        "checkout",
        "in_prep",
        2,
        ["security", "billing"],
        "ananya",
        25,
        8,
    ),
    (
        "Invoice PDF layout refresh",
        "web",
        "billing",
        "backlog",
        4,
        ["billing", "ux"],
        "sneha",
        None,
        3,
    ),
]
PRIVATE = [
    ("priya", "Prepare sprint review notes", "in_development"),
    ("rahul", "Read up on accessibility audit tools", "backlog"),
    ("ananya", "Draft mobile release checklist", "ready"),
]


class Seeder:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.cookies: dict[str, str] = {}

    async def call(self, who: str, method: str, url: str, body: Any = None) -> Any:
        res = await self.client.request(
            method,
            f"/api/v1{url}",
            json=body,
            headers={**XHR, "cookie": self.cookies[who]},
        )
        self.client.cookies.clear()
        if res.status_code >= 400:
            raise RuntimeError(f"{method} {url} as {who}: {res.status_code} {res.text}")
        return res.json() if res.content else None

    async def sign_in(self, who: str, user_id: str) -> None:
        res = await self.client.post(
            "/api/v1/auth/dev/sign-in", json={"userId": user_id}, headers=XHR
        )
        self.client.cookies.clear()
        if res.status_code != 204:
            raise RuntimeError(f"sign-in {who}: {res.status_code} {res.text}")
        self.cookies[who] = res.headers["set-cookie"].split(";", 1)[0]


async def seed() -> None:
    settings = load_settings(
        {"AUTH_DEV_MODE": "true", "RL_SIGNIN_IP": "600/min", "RL_DEFAULT_IP": "6000/min"}
    )
    if settings.APP_PROFILE == "prod":
        raise SystemExit("seed_demo is for dev and trial databases; APP_PROFILE=prod refuses it")
    app = create_app(settings)
    async with app.state.sessionmaker() as session:
        await SeedService(
            UnitOfWork(session), UserRepository(session), SuiteRepository(session), app.state.clock
        ).seed_admin(ADMIN_EMAIL)
    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50001))
    async with httpx.AsyncClient(transport=transport, base_url="http://seed") as client:
        s = Seeder(client)
        users = (await client.get("/api/v1/auth/dev/users")).json()["items"]
        admin_id = next(u["id"] for u in users if u["email"] == ADMIN_EMAIL)
        await s.sign_in("admin", admin_id)

        teams_now = await s.call("admin", "GET", "/teams")
        if any(t["name"].lower() == MARKER_TEAM.lower() for t in teams_now["items"]):
            print(f'Demo data is already there (team "{MARKER_TEAM}" exists); nothing added.')
            return

        today = app.state.clock.now().date()

        def day(offset: int | None) -> str | None:
            return None if offset is None else (today + timedelta(days=offset)).isoformat()

        # Tags (keep any that already exist).
        known = {t["name"].lower() for t in (await s.call("admin", "GET", "/tags"))["items"]}
        for tag in TAGS:
            if tag not in known:
                await s.call("admin", "POST", "/tags", {"name": tag})

        team_ids = {}
        for key, (name, description) in TEAMS.items():
            team = await s.call(
                "admin", "POST", "/teams", {"name": name, "description": description}
            )
            team_ids[key] = team["id"]

        program = await s.call(
            "admin",
            "POST",
            "/programs",
            {
                "name": "Customer Portal 2.0",
                "description": "One portal for billing, accounts and checkout.",
                "targetDate": day(90),
            },
        )
        projects = {}
        for key, name, team, offset in (
            ("billing", "Billing revamp", "web", 60),
            ("accounts", "Accounts self-service", "platform", 75),
            ("checkout", "Mobile checkout", "mobile", 45),
        ):
            project = await s.call(
                "admin",
                "POST",
                "/projects",
                {
                    "name": name,
                    "teamId": team_ids[team],
                    "programId": program["id"],
                    "targetDate": day(offset),
                },
            )
            projects[key] = project["id"]

        # People: invited by the admin, then signed in once (which admits them, D-083).
        people = {}
        for key, name, email, teams, lead in PEOPLE:
            user = await s.call(
                "admin",
                "POST",
                "/users",
                {"name": name, "email": email, "teamIds": [team_ids[t] for t in teams]},
            )
            people[key] = user["id"]
            if lead:
                await s.call(
                    "admin",
                    "PATCH",
                    f"/teams/{team_ids[lead]}/members/{user['id']}",
                    {"isLead": True},
                )
            await s.sign_in(key, user["id"])

        cards = {}
        for title, team, project, state, priority, tags, who, eta, effort in CARDS:
            body: dict[str, Any] = {
                "title": title,
                "plane": "org",
                "teamId": team_ids[team],
                "state": state,
                "priority": priority,
                "tags": tags,
                "assigneeId": people[who],
                "eta": day(eta),
                "effortHours": effort,
            }
            if project:
                body["projectId"] = projects[project]
            card = await s.call(who, "POST", "/cards", body)
            cards[title] = (card["key"], who)

        for who, title, state in PRIVATE:
            await s.call(who, "POST", "/cards", {"title": title, "state": state})

        # A dependency, a blocker, comments with a reply and a vote, and logged time.
        search_key, _ = cards["Fast trip search"]
        booking_key, _ = cards["Revise and streamline booking flow"]
        cart_key, _ = cards["Shopping cart purchasing error - quick fix"]
        tokens_key, _ = cards["Saved cards: tokenise on device"]
        await s.call(
            "kavya",
            "POST",
            f"/cards/{booking_key}/links",
            {"type": "depends_on", "targetKey": search_key},
        )
        await s.call(
            "ananya",
            "POST",
            f"/cards/{cart_key}/links",
            {"type": "blocks", "targetKey": tokens_key},
        )
        top = await s.call(
            "priya",
            "POST",
            f"/cards/{search_key}/comments",
            {"body": "Caching the fare lookups cut the p95 from 1.8 s to 420 ms on staging."},
        )
        await s.call(
            "arjun",
            "POST",
            f"/cards/{search_key}/comments",
            {
                "body": "Nice. Shall we keep the old path behind a flag for one release?",
                "parentId": top["id"],
            },
        )
        await s.call("arjun", "PUT", f"/cards/{search_key}/comments/{top['id']}/vote", {"value": 1})
        await s.call(
            "ananya",
            "POST",
            f"/cards/{cart_key}/comments",
            {"body": "Reproduced on Android 14 when the cart has more than 20 items."},
        )
        await seed_time(s, cards, today)
        await s.call(
            "rahul",
            "POST",
            f"/projects/{projects['billing']}/attachments",
            {
                "title": "Billing revamp - design",
                "url": "https://design.example.test/billing",
                "kind": "design",
            },
        )

    await app.state.engine.dispose()
    print(
        f"Seeded {len(PEOPLE)} people, {len(TEAMS)} teams, 1 program, {len(projects)} projects, "
        f"{len(CARDS) + len(PRIVATE)} cards with comments, links and time. "
        f"Sign in as any of them on the dev sign-in page."
    )


async def seed_time(s: "Seeder", cards: dict[str, tuple[str, str]], today: date) -> None:
    """D-116: each person's time on their own open cards, alternating between them by day."""
    open_cards: dict[str, list[str]] = {}
    for title, _team, _project, state, *_rest in CARDS:
        key, who = cards[title]
        if state not in ("delivered", "cancelled"):
            open_cards.setdefault(who, []).append(key)
    monday = today - timedelta(days=today.weekday())
    for who, (last, off, note) in LAST_WEEK.items():
        keys = open_cards.get(who, [])
        if not keys:
            continue
        weeks = [(monday - timedelta(days=14), [8.0] * 5), (monday - timedelta(days=7), last)]
        weeks.append((monday, [6.0 if who == "vikram" else 8.0] * 5))
        for start, hours in weeks:
            for i, h in enumerate(hours):
                d = start + timedelta(days=i)
                if d > today or h <= 0:
                    continue
                if d == today:
                    h = 3.0
                key = keys[(i + start.toordinal() // 7) % len(keys)]
                await s.call(
                    who,
                    "POST",
                    f"/cards/{key}/time",
                    {"date": d.isoformat(), "hours": h, "note": TIME_NOTES[(i + len(who)) % 6]},
                )
        last_monday = monday - timedelta(days=7)
        if off is not None:
            leave = (last_monday + timedelta(days=off)).isoformat()
            await s.call(who, "PUT", f"/me/time/days/{leave}/off", {"kind": "leave"})
        if note:
            url = f"/me/time/weeks/{last_monday.isoformat()}/note"
            await s.call(who, "PUT", url, {"note": note})


def main() -> None:
    if sys.platform == "win32":
        asyncio.run(seed(), loop_factory=asyncio.SelectorEventLoop)
    else:
        asyncio.run(seed())


if __name__ == "__main__":
    main()
