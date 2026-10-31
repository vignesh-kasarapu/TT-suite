"""Portal application factory: API routers, CSRF + security headers, the mail worker, the
global-admin seed, and - last, so it never shadows an API route - the gateway."""

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable, MutableMapping
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI
from starlette.middleware.gzip import GZipMiddleware

from app import gateway
from app.controllers import admin_controller, auth_controller, me_controller, system_controller
from app.core import errors
from app.core.config import Settings
from app.core.database import create_engine, create_sessionmaker
from app.repositories.suite_repository import SuiteRepository
from app.request_log import RequestLogMiddleware
from app.services.admin_service import AdminService
from app.services.apps_client import AppsClient
from app.services.mail_service import MailSender, drain
from app.services.seed_file import SeedPerson, load_seed
from suite_core.integrations.entra_oidc import EntraClient
from suite_core.integrations.graph import GraphClient

log = logging.getLogger("portal")
MAIL_INTERVAL_S = 15
SEED_RETRY_S = 5

Scope = MutableMapping[str, Any]
ASGI = Callable[[Scope, Callable[[], Awaitable[Any]], Callable[[Any], Awaitable[None]]], Awaitable[None]]
SAFE = frozenset({"GET", "HEAD", "OPTIONS"})


class CsrfMiddleware:
    """Non-GET portal API calls need `X-Requested-With: XHR` (Kanban TC-012). Proxied app calls
    are left to the app's own check, which sees the same header."""

    def __init__(self, app: ASGI) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Any, send: Any) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE and scope["path"].startswith("/api/"):
            if dict(scope["headers"]).get(b"x-requested-with") != b"XHR":
                body = b'{"code":"CSRF_HEADER_MISSING","detail":"Send X-Requested-With: XHR."}'
                await send({"type": "http.response.start", "status": 403,
                            "headers": [(b"content-type", b"application/json")]})
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGI) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def with_headers(message: Any) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                names = {k.lower() for k, _ in headers}
                for k, v in ((b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"same-origin"),
                             (b"x-frame-options", b"DENY")):
                    if k not in names:
                        headers.append((k, v))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, with_headers)


async def _mail_loop(app: FastAPI) -> None:
    sender = MailSender(app.state.settings, app.state.http)
    while True:
        await asyncio.sleep(MAIL_INTERVAL_S)
        try:
            async with app.state.sessionmaker() as db:
                await drain(SuiteRepository(db), sender)
                await db.commit()
        except Exception:  # a failed tick must not stop the loop
            log.exception("mail_worker")


async def _seed_loop(app: FastAPI) -> None:
    """Make SEED_GLOBAL_ADMIN_EMAIL a global admin with admin in every app, and add the people in
    SEED_FILE where missing, retrying until the apps (started alongside) answer."""
    settings: Settings = app.state.settings
    admin_pending = bool(settings.SEED_GLOBAL_ADMIN_EMAIL)
    people: list[SeedPerson] = []
    if settings.SEED_FILE:
        try:
            people = load_seed(settings.SEED_FILE)
        except (OSError, ValueError) as err:  # a broken seed file must not stop the portal
            log.error("SEED_FILE %s not loaded: %s", settings.SEED_FILE, err)
    for _ in range(120):
        if not admin_pending and not people:
            return
        try:
            async with app.state.sessionmaker() as db:
                svc = AdminService(db, settings, AppsClient(settings, app.state.http))
                if admin_pending:
                    pending = await svc.seed_global_admin(settings.SEED_GLOBAL_ADMIN_EMAIL,
                                                          settings.SEED_GLOBAL_ADMIN_EMPLOYEE_CODE)
                    admin_pending = bool(pending)
                    log.info("seed_global_admin %s", f"waiting for {pending}" if pending else "done")
                if people:
                    people = await svc.seed_people(people)
                    log.info("seed file %s", f"waiting for {len(people)} people" if people else "done")
        except Exception:
            log.exception("seed")
        await asyncio.sleep(SEED_RETRY_S)


def create_app(settings: Settings, *, background: bool = True) -> FastAPI:
    engine = create_engine(settings.DATABASE_URL, settings.DB_POOL_SIZE)
    http = httpx.AsyncClient(timeout=15.0)
    proxy_http = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0), follow_redirects=False)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        tasks = [asyncio.create_task(_mail_loop(app)), asyncio.create_task(_seed_loop(app))] if background else []
        yield
        for t in tasks:
            t.cancel()
        await http.aclose()
        await proxy_http.aclose()
        await engine.dispose()

    app = FastAPI(title="TT Suite portal", lifespan=lifespan, docs_url=None if settings.APP_PROFILE == "prod" else "/api/docs",
                  openapi_url=None if settings.APP_PROFILE == "prod" else "/api/openapi.json", redoc_url=None)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = create_sessionmaker(engine)
    app.state.http = http
    app.state.proxy_http = proxy_http
    app.state.started_at = time.monotonic()  # the request log's boot grace for "app not reachable"
    app.state.unavailable_since = {}  # app -> when it stopped answering (gateway)
    app.state.graph = GraphClient(settings, http)
    app.state.entra = EntraClient(settings, http) if settings.AUTH_PROVIDER == "entra" else None

    errors.register(app)
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    # Every app's pages, bundles and API replies go out through here: gzip them (a 600 KB bundle is
    # ~180 KB on a phone's connection). A reply an app already compressed passes through as is.
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(RequestLogMiddleware)  # outermost: logs every request, CSRF refusals included
    for r in (auth_controller.router, auth_controller.legacy_router, me_controller.router, admin_controller.router,
              system_controller.router):
        app.include_router(r)
    gateway.mount(app, settings)
    return app
