"""Cards and a week of time from Solution/seed-data.json (D-137), after `npm run seed` has loaded
its people, teams and tags.

    node scripts/py.mjs -m scripts.seed_data [path/to/seed-data.json]   (npm run seed runs it)

Goes through the API in-process, signed in as each person (dev sign-in mounted in this process
only), so every rule applies and every card writes its events. Each card is created by its
assignee, so nobody is mailed. Idempotent: a card whose title already exists is skipped, and a
person who already has time in the seeded week gets none added. Refused in prod.
"""

import asyncio
import json
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx

from app.core.config import load_settings
from app.main import create_app

XHR = {"x-requested-with": "XHR"}
DEFAULT_FILE = Path(__file__).resolve().parents[2] / "seed-data.json"
OPEN = ("backlog", "in_prep", "ready", "in_development", "uat")


class Api:
    def __init__(self, client: httpx.AsyncClient, ids: dict[str, str]) -> None:
        self.client, self.ids = client, ids
        self.cookies: dict[str, str] = {}

    async def as_(self, email: str, method: str, url: str, body: Any = None) -> Any:
        if email not in self.cookies:
            res = await self.client.post(
                "/api/v1/auth/dev/sign-in", json={"userId": self.ids[email]}, headers=XHR
            )
            if res.status_code != 204:
                raise RuntimeError(f"sign-in {email}: {res.status_code} {res.text}")
            self.cookies[email] = res.headers["set-cookie"].split(";", 1)[0]
            self.client.cookies.clear()
        res = await self.client.request(
            method, f"/api/v1{url}", json=body, headers={**XHR, "cookie": self.cookies[email]}
        )
        self.client.cookies.clear()
        if res.status_code >= 400:
            raise RuntimeError(f"{method} {url} as {email}: {res.status_code} {res.text}")
        return res.json() if res.content else None


async def seed(data: dict[str, Any]) -> None:
    # This process only: dev sign-in to act as each person; no mail leaves it (stub).
    settings = load_settings(
        {
            "AUTH_DEV_MODE": "true",
            "AUTH_PROVIDER": "dev",
            "MAIL_PROVIDER": "stub",
            "RL_SIGNIN_IP": "600/min",
            "RL_DEFAULT_IP": "6000/min",
        }
    )
    if settings.APP_PROFILE == "prod":
        raise SystemExit("seed_data is for dev and trial databases; APP_PROFILE=prod refuses it")
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 50002))
    async with httpx.AsyncClient(transport=transport, base_url="http://seed") as client:
        people = (await client.get("/api/v1/auth/dev/users")).json()["items"]
        ids = {p["email"].lower(): p["id"] for p in people}
        missing = {c["assignee"].lower() for c in data.get("cards", [])} - ids.keys()
        if missing:
            raise SystemExit(f"Not in the database yet (run the people seed first): {missing}")
        api = Api(client, ids)
        admin = next(p["email"].lower() for p in people if p["role"] == "admin")
        teams = {
            t["name"].lower(): t["id"] for t in (await api.as_(admin, "GET", "/teams"))["items"]
        }
        board = await api.as_(admin, "GET", "/boards/my-org?includeClosed=true")
        # Title -> (key, assignee id, state) of the org cards already there.
        existing = {
            c["title"]: (c["key"], c["assigneeId"], state)
            for state, col in board["columns"].items()
            for c in col
        }

        added = 0
        open_cards: dict[str, list[str]] = {}
        for c in data.get("cards", []):
            who = c["assignee"].lower()
            if c["title"] in existing:
                # Already seeded (an earlier run): still counts for the time below, so a run that
                # stopped between cards and time is completed by the next one.
                key, holder, state = existing[c["title"]]
                if holder == ids[who] and state in OPEN:
                    open_cards.setdefault(who, []).append(key)
                continue
            body = {
                "title": c["title"],
                "plane": "org",
                "teamId": teams[c["team"].lower()],
                "state": c["state"],
                **({"priority": c["priority"]} if c.get("priority") else {}),
            }
            card = await api.as_(who, "POST", "/cards", body)
            added += 1
            if c["state"] in OPEN:
                open_cards.setdefault(who, []).append(card["key"])

        logged = await seed_time(api, data.get("time"), open_cards, app.state.clock.now().date())
    print(f"seeded {added} cards ({len(existing)} were there), time for {logged} people")


async def seed_time(
    api: Api, rule: dict[str, Any] | None, open_cards: dict[str, list[str]], today: date
) -> int:
    """One working week (Mon-Fri) per person, `hoursPerDay` a day spread over their open cards."""
    if not rule:
        return 0
    monday = today - timedelta(days=today.weekday())
    if rule.get("week", "last") == "last":
        monday -= timedelta(days=7)
    hours = float(rule.get("hoursPerDay", 8))
    people = 0
    for who, keys in open_cards.items():
        week = await api.as_(who, "GET", f"/me/time?week={monday.isoformat()}")
        if float(week.get("total") or 0) > 0:
            continue
        for i in range(5):
            day = monday + timedelta(days=i)
            if day > today:
                break
            key = keys[i % len(keys)]
            note = rule.get("note", "")
            await api.as_(
                who,
                "POST",
                f"/cards/{key}/time",
                {"date": day.isoformat(), "hours": hours, "note": note},
            )
        people += 1
    return people


def main() -> None:
    file = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FILE
    data = json.loads(file.read_text(encoding="utf-8"))
    if sys.platform == "win32":
        asyncio.run(seed(data), loop_factory=asyncio.SelectorEventLoop)
    else:
        asyncio.run(seed(data))


if __name__ == "__main__":
    main()
