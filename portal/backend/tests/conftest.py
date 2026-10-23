"""Portal tests against the local suite Postgres (deploy/docker-compose.yml, port 5433).

The three apps are replaced by a fake behind httpx.MockTransport that follows the contract:
`/internal/provision` mirrors into `suite.app_access` with suite_core (exactly what the real
apps do in their own transaction) and `/internal/authorize` answers from it.
"""

import asyncio
import json
import os
import sys
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import load_settings
from app.main import create_app
from suite_core import identity
from suite_core.migrate import migrate

OWNER = os.environ.get("PORTAL_TEST_OWNER_URL", "postgresql://app_owner:dev@localhost:5433/ttsuite_test")
RW = os.environ.get("PORTAL_TEST_DATABASE_URL", "postgresql://app_rw:dev@localhost:5433/ttsuite_test")
TOKEN = "test-internal-token"
ADMIN = "admin@tektalis.com"


@pytest.fixture(scope="session")
def anyio_backend() -> Any:
    if sys.platform == "win32":
        return ("asyncio", {"loop_factory": asyncio.SelectorEventLoop})
    return "asyncio"


@pytest.fixture(scope="session")
def sync_engine():
    migrate(OWNER, "app_rw")
    eng = create_engine(RW.replace("postgresql://", "postgresql+psycopg://"))
    yield eng
    eng.dispose()


class FakeApps:
    """Records calls; refuses when told to; mirrors like a real app."""

    def __init__(self, engine) -> None:
        self.engine = engine
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.refuse: dict[str, tuple[int, str]] = {}
        self.down: set[str] = set()

    def handler(self, request: httpx.Request) -> httpx.Response:
        app = {"8002": "kanban", "8003": "lms", "8004": "expense"}[str(request.url.port)]
        if app in self.down:
            raise httpx.ConnectError("down")
        if request.url.path.startswith("/internal") and request.headers.get("x-internal-token") != TOKEN:
            return httpx.Response(401, json={"code": "INTERNAL_TOKEN", "detail": "no"})
        body = json.loads(request.content or b"{}")
        self.calls.append((app, request.url.path, body))
        if request.url.path == "/internal/teams":
            return httpx.Response(200, json=[{"id": "T1", "name": "Platform"}, {"id": "T2", "name": "Web"}])
        if request.url.path.endswith("/health"):
            return httpx.Response(200, json={"status": "ok"})
        if app in self.refuse:
            status, code = self.refuse[app]
            return httpx.Response(status, json={"code": code, "detail": f"{app} says no"})
        with Session(self.engine) as db:
            if request.url.path == "/internal/provision":
                identity.mirror_access(db, email=body["email"], name=body["name"], app=app, role=body["role"],
                                       source=body["source"], actor=body["actor_id"])
                db.commit()
                return httpx.Response(200, json={"ok": True, "local_user_id": "L1", "role": body["role"]})
            if request.url.path == "/internal/authorize":
                role = identity.access_of(db, body["suite_user_id"], app)
                return httpx.Response(200, json={"allowed": role is not None, "role": role,
                                                 "code": None if role else "NO_APP_ACCESS"})
        return httpx.Response(404)


@pytest.fixture
def fake_apps(sync_engine) -> FakeApps:
    owner = create_engine(OWNER.replace("postgresql://", "postgresql+psycopg://"))
    with owner.begin() as c:  # TRUNCATE is the owner's privilege, not the runtime role's
        c.execute(text("TRUNCATE suite.users, suite.audit_log, suite.mail_outbox CASCADE"))
    owner.dispose()
    return FakeApps(sync_engine)


@pytest.fixture
async def portal(fake_apps, tmp_path) -> AsyncIterator[httpx.AsyncClient]:
    (tmp_path / "portal").mkdir()
    (tmp_path / "portal" / "index.html").write_text("<html>portal</html>")
    (tmp_path / "kanban" / "assets").mkdir(parents=True)
    (tmp_path / "kanban" / "index.html").write_text("<html>kanban</html>")
    (tmp_path / "kanban" / "assets" / "a.js").write_text("js")
    settings = load_settings(
        {"APP_PROFILE": "test", "DATABASE_URL": RW, "DATABASE_OWNER_URL": OWNER, "INTERNAL_TOKEN": TOKEN,
         "AUTH_PROVIDER": "dev", "STATIC_DIR": str(tmp_path)},
        env_file=None,
    )
    app = create_app(settings, background=False)
    transport = httpx.MockTransport(fake_apps.handler)
    app.state.http = httpx.AsyncClient(transport=transport)
    app.state.proxy_http = httpx.AsyncClient(transport=transport)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://suite.test",
                                 headers={"x-requested-with": "XHR"}) as client:
        client.app = app  # type: ignore[attr-defined]
        yield client
    await app.state.engine.dispose()


async def seed_admin(client: httpx.AsyncClient) -> None:
    from app.services.admin_service import AdminService
    from app.services.apps_client import AppsClient

    app = client.app  # type: ignore[attr-defined]
    async with app.state.sessionmaker() as db:
        pending = await AdminService(db, app.state.settings, AppsClient(app.state.settings, app.state.http)).seed_global_admin(ADMIN)
    assert pending == []


async def sign_in(client: httpx.AsyncClient, email: str) -> None:
    client.cookies.clear()
    res = await client.post("/api/auth/dev/sign-in", json={"email": email})
    assert res.status_code == 204, res.text
