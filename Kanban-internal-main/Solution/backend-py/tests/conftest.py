"""Shared test setup.

Integration tests need the Compose PostgreSQL (`docker compose -f Solution/docker-compose.yml
up -d db`). `app_template` is migrated once per run; every test module clones it into its own
database, so modules never see each other's rows.

TT Suite: the template also gets the portal's `app` schema (suite_core.migrate), because
sign-in now resolves the suite session cookie. Kanban's own tables are in schema `kanban`;
owner_url()/app_url() carry its search_path, so test SQL stays unqualified. Against the
suite's shared Postgres (port 5433) set TEST_PG_HOST=localhost:5433, TEST_ADMIN_URL=postgresql://postgres:postgres@localhost:5433/
postgres, and TEST_TEMPLATE_DB / TEST_DB_PREFIX to keep Kanban's databases apart from the other
apps'.
"""

import asyncio
import io
import os
import sys
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
import psycopg
import pytest
from suite_core.constants import session_cookie_name
from suite_core.migrate import migrate as migrate_suite

from app.core.config import Settings, load_settings
from app.core.database import with_search_path
from app.core.logging import configure_logging
from app.db.migrate import migrate_up
from app.main import create_app
from tests.fixtures import fixture_id, seed_dev

if sys.platform == "win32":
    # psycopg's async driver needs the selector event loop on Windows.
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

HOST = os.environ.get("TEST_PG_HOST", "localhost:5432")
ADMIN_URL = os.environ.get("TEST_ADMIN_URL", f"postgresql://postgres:dev@{HOST}/postgres")
TEMPLATE_DB = os.environ.get("TEST_TEMPLATE_DB", "app_template")
DB_PREFIX = os.environ.get("TEST_DB_PREFIX", "")
SPA_FIXTURE_DIR = Path(__file__).parent / "integration" / "spa"
CSRF = {"x-requested-with": "XHR"}
SESSION_COOKIE = session_cookie_name("test")  # the suite cookie, `tt_session`


def owner_url(db: str) -> str:
    return with_search_path(f"postgres://app_owner:dev@{HOST}/{db}")


def app_url(db: str) -> str:
    return with_search_path(f"postgres://app_rw:dev@{HOST}/{db}")


def admin_sql(*statements: str) -> None:
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        for s in statements:
            c.execute(s)


@pytest.fixture(scope="session")
def migrated_template() -> str:
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        known = c.execute("SELECT 1 FROM pg_database WHERE datname = %s", (TEMPLATE_DB,))
        if known.fetchone() is None:
            c.execute(f"CREATE DATABASE {TEMPLATE_DB} OWNER app_owner")
    migrate_up(owner_url(TEMPLATE_DB))
    migrate_suite(owner_url(TEMPLATE_DB), "app_rw")
    return TEMPLATE_DB


def db_name(name: str) -> str:
    return name if name.startswith(DB_PREFIX) else f"{DB_PREFIX}{name}"


def create_test_db(name: str) -> str:
    name = db_name(name)
    admin_sql(
        f"DROP DATABASE IF EXISTS {name} WITH (FORCE)",
        f"CREATE DATABASE {name} TEMPLATE {TEMPLATE_DB} OWNER app_owner",
    )
    return name


def drop_test_db(name: str) -> None:
    admin_sql(f"DROP DATABASE IF EXISTS {db_name(name)} WITH (FORCE)")


@dataclass
class Session:
    cookie: str
    user_id: str


@dataclass
class Api:
    """In-process HTTP client for one app instance. Cookies are never kept between calls:
    a test says explicitly which session it calls as."""

    client: httpx.AsyncClient
    settings: Settings
    db: str
    logs: io.StringIO
    app: Any
    extra: dict[str, Any] = field(default_factory=dict)

    async def call(
        self,
        method: str,
        url: str,
        *,
        session: Session | None = None,
        json: Any = None,
        headers: dict[str, str] | None = None,
        content: bytes | str | None = None,
        csrf: bool = True,
    ) -> httpx.Response:
        h: dict[str, str] = dict(CSRF) if csrf else {}
        if session:
            h["cookie"] = session.cookie
        h.update(headers or {})
        try:
            return await self.client.request(method, url, json=json, headers=h, content=content)
        finally:
            self.client.cookies.clear()

    async def sign_in(self, code: str) -> Session:
        user_id = fixture_id(code)
        res = await self.call("POST", "/api/v1/auth/dev/sign-in", json={"userId": user_id})
        assert res.status_code == 204, res.text
        return Session(cookie=cookie_of(res, SESSION_COOKIE), user_id=user_id)

    async def set_clock(self, iso: str) -> None:
        res = await self.call("PUT", "/api/v1/dev/clock", json={"now": iso})
        assert res.status_code == 204, res.text

    def seed(self) -> None:
        seed_dev(app_url(self.db))

    def make_lead(self, team_id: str, user_id: str) -> None:
        """Lead is a suite role only the global admin assigns (through /internal/provision);
        a test that needs a lead of a team the person is in sets the flag directly."""
        with psycopg.connect(app_url(self.db)) as c:
            c.execute(
                "UPDATE team_member SET is_lead = true WHERE team_id = %s AND user_id = %s",
                (team_id, user_id),
            )


def cookie_of(res: httpx.Response, name: str) -> str:
    for raw in res.headers.get_list("set-cookie"):
        k, _, rest = raw.partition("=")
        if k == name:
            return f"{name}={rest.split(';', 1)[0]}"
    raise AssertionError(f"{name} cookie not set: {res.headers.get_list('set-cookie')}")


def assert_problem(res: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert res.status_code == status, res.text
    assert res.headers["content-type"].startswith("application/problem+json"), res.headers
    body: dict[str, Any] = res.json()
    assert body["code"] == code, body
    assert body["status"] == status
    assert body["type"] == "about:blank"
    assert isinstance(body["title"], str)
    assert isinstance(body["correlationId"], str) and body["correlationId"]
    return body


AppFactory = Callable[..., Awaitable[Api]]


@pytest.fixture(scope="module")
async def make_api(migrated_template: str) -> AsyncIterator[AppFactory]:
    """`await make_api("t_name", APP_PROFILE="dev")` -> Api on a fresh clone of the template."""
    made: list[Api] = []

    async def factory(db: str, **env: str) -> Api:
        db = create_test_db(db)
        overrides = {
            "APP_PROFILE": "test",
            "DATABASE_URL": app_url(db),
            "DATABASE_OWNER_URL": owner_url(db),
            "MAIL_PROVIDER": "stub",
            "AUTH_DEV_MODE": "true",
            **env,
        }
        settings = load_settings(overrides, env_file=None)
        logs = io.StringIO()
        configure_logging(settings.LOG_LEVEL, logs)
        app = create_app(settings, static_dir=SPA_FIXTURE_DIR)
        client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 50000)),
            base_url="http://test",
        )
        api = Api(client=client, settings=settings, db=db, logs=logs, app=app)
        made.append(api)
        return api

    yield factory
    for api in made:
        await api.client.aclose()
        await api.app.state.engine.dispose()
        drop_test_db(api.db)
