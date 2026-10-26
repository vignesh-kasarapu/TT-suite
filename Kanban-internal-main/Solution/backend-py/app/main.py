"""Application factory.

Boot (see `app/__main__.py`): settings -> logging -> migrations (owner URL, closed afterwards)
-> seed -> serve. `create_app()` itself never touches the network, so tests build it offline.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI

from app.controllers import (
    auth_controller,
    card_controller,
    card_parts_controller,
    inbox_report_controller,
    internal_controller,
    login_issue_controller,
    mail_template_controller,
    me_controller,
    program_controller,
    system_controller,
    tag_controller,
    team_controller,
    time_controller,
    user_controller,
)
from app.controllers.spa_controller import spa_router
from app.core.clock import Clock, FakeClock, SystemClock
from app.core.config import Settings
from app.core.database import create_engine, create_sessionmaker
from app.exceptions.handlers import register_exception_handlers
from app.integrations.graph import GraphClient
from app.middleware.pipeline import (
    BodyLimitMiddleware,
    CsrfMiddleware,
    RateLimitMiddleware,
    RequestContextMiddleware,
)
from app.workers import notification_worker

API_PREFIX = "/api/v1"
DEFAULT_STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"

DESCRIPTION = """All business rules, permissions and state transitions are executed by the backend.
The frontend renders responses and validates for UX only.

- Base path `/api/v1`. IDs are opaque ULIDs. Timestamps are RFC 3339 UTC; dates are `YYYY-MM-DD`.
- Errors are RFC 9457 `application/problem+json` with a stable machine `code`.
- Lists are paginated with `offset`/`limit` (limit <= 100, default 25) and return `total`.
- Updates carry a `version`; a stale version returns 409 `STALE_VERSION`.
- Every non-GET request must carry `X-Requested-With: XHR`. Session: the TT Suite portal's
  `__Host-tt_session` cookie (sign-in and sign-out are the portal's).
- `x-roles` on every operation: `anonymous`, `member`, `admin`, `dev` (never mounted in prod).
"""


def make_clock(settings: Settings) -> Clock:
    if settings.APP_PROFILE == "prod":
        return SystemClock()
    return FakeClock(settings.APP_FAKE_NOW or None)


def create_app(settings: Settings, *, static_dir: Path | None = None) -> FastAPI:
    engine = create_engine(settings.DATABASE_URL, settings.DB_POOL_SIZE)
    http = httpx.AsyncClient(timeout=15.0)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Outbox sender (D-073); the test profile drains through POST /dev/notifications/run.
        worker = (
            None
            if settings.APP_PROFILE == "test"
            else asyncio.create_task(notification_worker.run(app))
        )
        yield
        if worker is not None:
            worker.cancel()
        await http.aclose()
        await engine.dispose()

    app = FastAPI(
        title="Kanban V1.0 API",
        version="1.0.0",
        description=DESCRIPTION,
        lifespan=lifespan,
        docs_url=None if settings.APP_PROFILE == "prod" else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.APP_PROFILE == "prod" else "/api/openapi.json",
    )
    app.router.redirect_slashes = False
    app.state.settings = settings
    app.state.clock = make_clock(settings)
    app.state.engine = engine
    app.state.sessionmaker = create_sessionmaker(engine)
    app.state.http = http
    app.state.graph = GraphClient(settings, http)

    register_exception_handlers(app)

    app.include_router(system_controller.router, prefix=API_PREFIX)
    app.include_router(auth_controller.router, prefix=API_PREFIX)
    app.include_router(me_controller.router, prefix=API_PREFIX)
    app.include_router(user_controller.router, prefix=API_PREFIX)
    app.include_router(team_controller.router, prefix=API_PREFIX)
    app.include_router(program_controller.programs, prefix=API_PREFIX)
    app.include_router(program_controller.projects, prefix=API_PREFIX)
    app.include_router(tag_controller.router, prefix=API_PREFIX)
    app.include_router(mail_template_controller.router, prefix=API_PREFIX)
    app.include_router(login_issue_controller.router, prefix=API_PREFIX)
    app.include_router(card_controller.boards, prefix=API_PREFIX)
    app.include_router(card_controller.cards, prefix=API_PREFIX)
    app.include_router(card_parts_controller.comments, prefix=API_PREFIX)
    app.include_router(card_parts_controller.links, prefix=API_PREFIX)
    app.include_router(card_parts_controller.time, prefix=API_PREFIX)
    app.include_router(card_parts_controller.attachments, prefix=API_PREFIX)
    app.include_router(time_controller.router, prefix=API_PREFIX)
    app.include_router(inbox_report_controller.inbox, prefix=API_PREFIX)
    app.include_router(inbox_report_controller.reports, prefix=API_PREFIX)
    # dev operations exist only outside prod; dev sign-in also needs AUTH_DEV_MODE=true. An
    # unmounted route answers exactly like an unknown one (404 NOT_FOUND).
    if settings.APP_PROFILE != "prod":
        app.include_router(system_controller.dev_router, prefix=API_PREFIX)
    if settings.dev_mode:
        app.include_router(auth_controller.dev_router, prefix=API_PREFIX)
    # TT Suite portal -> Kanban (SUITE-CONTRACT §3.2): app root, never proxied, token-guarded.
    app.include_router(internal_controller.router)
    app.include_router(spa_router(static_dir or DEFAULT_STATIC_DIR))

    # The contract lists paths relative to its server `/api/v1`, as the frontend client calls them.
    generated = app.openapi

    def contract() -> dict[str, Any]:
        schema = generated()  # cached by FastAPI, so this rewrite runs once
        if "servers" not in schema:
            schema["servers"] = [{"url": API_PREFIX, "description": "Same origin as the SPA"}]
            schema["paths"] = {p.removeprefix(API_PREFIX): v for p, v in schema["paths"].items()}
            # Request validation fails as RFC 9457 problem+json, not FastAPI's default body.
            for item in schema["paths"].values():
                for op in item.values():
                    if "422" in op.get("responses", {}):
                        op["responses"]["422"] = {
                            "description": "Validation failed",
                            "content": {
                                "application/problem+json": {
                                    "schema": {"$ref": "#/components/schemas/Problem"}
                                }
                            },
                        }
            for name in ("HTTPValidationError", "ValidationError"):
                schema["components"]["schemas"].pop(name, None)
        return schema

    app.openapi = contract  # type: ignore[method-assign]

    # Added innermost first: the request passes context -> rate limit -> CSRF -> body cap.
    app.add_middleware(BodyLimitMiddleware, max_bytes=settings.BODY_MAX_JSON)
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(RateLimitMiddleware, settings=settings)
    app.add_middleware(RequestContextMiddleware, settings=settings)
    return app
