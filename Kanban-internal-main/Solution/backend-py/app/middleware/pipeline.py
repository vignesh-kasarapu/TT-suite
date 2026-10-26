"""Request pipeline (pure ASGI, outermost first):

1. RequestContextMiddleware - correlation id (minted or taken from X-Correlation-Id, echoed),
   security headers on every response, the clearing session cookie after an expired session,
   one allow-listed log line per request, and a safe 500 for anything unexpected.
2. RateLimitMiddleware - per-IP fixed windows; counts every request first, so a refused
   request still counts (DEF-009). The TT Suite's `/internal/*` (localhost, token-guarded,
   SUITE-CONTRACT §3.2) is never limited.
3. CsrfMiddleware - non-GET /api requests need `X-Requested-With: XHR`; refused before the body
   is read (TC-012). `/internal/*` is not under /api, so it is not checked.
4. BodyLimitMiddleware - bodies over BODY_MAX_JSON are refused with 413 before parsing.

Authentication runs after these, as the first dependency of every route (dependencies/auth.py),
and so before body validation.
"""

import math
import time
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

import structlog
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import Settings, parse_rate
from app.core.logging import get_logger, redact_path
from app.core.security import clear_session_cookie
from app.exceptions.custom_exceptions import (
    AppException,
    CsrfHeaderMissingException,
    PayloadTooLargeException,
    RateLimitedException,
)
from app.exceptions.handlers import app_exception_response, internal_error_response

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

CSP = (
    "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; "
    "form-action 'self'; style-src 'self' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com"
)
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
CSRF_EXEMPT: frozenset[str] = frozenset()
INTERNAL_PREFIX = "/internal/"
HEALTH_PATH = "/api/v1/health"
DEV_SIGN_IN_PATH = "/api/v1/auth/dev/sign-in"
CONTACT_ADMIN_PATH = "/api/v1/auth/contact-admin"
DOCS_PATH = "/api/docs"


def _state(scope: Scope) -> dict[str, Any]:
    state: dict[str, Any] = scope.setdefault("state", {})
    return state


def _header(scope: Scope, name: bytes) -> str | None:
    for k, v in scope.get("headers", []):
        if k == name:
            return str(v.decode("latin-1"))
    return None


async def _send_exception(scope: Scope, receive: Receive, send: Send, exc: AppException) -> None:
    response = app_exception_response(str(_state(scope).get("correlation_id", "")), exc)
    await response(scope, receive, send)


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    def _security_headers(self, path: str, default_cache: bool) -> list[tuple[bytes, bytes]]:
        h = [
            (b"x-frame-options", b"DENY"),  # legacy twin of frame-ancestors 'none'
            (b"x-content-type-options", b"nosniff"),
            (b"referrer-policy", b"strict-origin-when-cross-origin"),
            (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
        ]
        # Swagger UI (dev/test only, never mounted in prod) loads its assets from a CDN.
        if path != DOCS_PATH:
            h.append((b"content-security-policy", CSP.encode()))
        if self.settings.APP_PROFILE != "dev":
            h.append((b"strict-transport-security", b"max-age=15552000; includeSubDomains"))
        if default_cache and path.startswith("/api/"):
            h.append((b"cache-control", b"no-store"))
        return h

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        cid = _header(scope, b"x-correlation-id") or str(uuid.uuid4())
        state = _state(scope)
        state["correlation_id"] = cid
        path: str = scope.get("path", "")
        status_holder = {"status": 500, "started": False}
        structlog.contextvars.bind_contextvars(correlationId=cid)

        async def send_wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                status_holder["started"] = True
                headers = list(message.get("headers", []))
                headers.append((b"x-correlation-id", cid.encode("latin-1")))
                # /api defaults to no-store; a route that sets its own caching keeps it.
                has_cache = any(k == b"cache-control" for k, _ in headers)
                headers.extend(self._security_headers(path, default_cache=not has_cache))
                if state.get("clear_session_cookie"):
                    cookie = clear_session_cookie(self.settings.APP_PROFILE)
                    headers.append((b"set-cookie", cookie.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapped)
        except Exception as err:
            get_logger().error("unhandled", err=err, code="INTERNAL")
            if not status_holder["started"]:
                await internal_error_response(cid)(scope, receive, send_wrapped)
        finally:
            actor = state.get("actor")
            fields: dict[str, Any] = {
                "route": f"{scope.get('method', '')} {redact_path(path)}",
                "status": status_holder["status"],
                "durationMs": round((time.perf_counter() - started) * 1000),
            }
            if actor is not None:
                fields["actorId"] = actor.id
            get_logger().info("request", **fields)
            structlog.contextvars.clear_contextvars()


class _Window:
    __slots__ = ("count", "reset_at")

    def __init__(self, reset_at: float) -> None:
        self.count = 0
        self.reset_at = reset_at


class RateLimitMiddleware:
    """Fixed window per (bucket, client IP). /health, dev sign-in and the contact-admin form
    (D-125) have their own limits instead of the default one."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.limits = {
            "default": parse_rate(settings.RL_DEFAULT_IP),
            "health": parse_rate(settings.RL_HEALTH_IP),
            "signin": parse_rate(settings.RL_SIGNIN_IP),
            "contact": parse_rate(settings.RL_CONTACT_IP),
        }
        self.windows: dict[tuple[str, str], _Window] = {}

    def _bucket(self, method: str, path: str) -> str:
        if path == HEALTH_PATH and method in ("GET", "HEAD"):
            return "health"
        if path == DEV_SIGN_IN_PATH and method == "POST":
            return "signin"
        if path == CONTACT_ADMIN_PATH and method == "POST":
            return "contact"
        return "default"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if scope.get("path", "").startswith(INTERNAL_PREFIX):
            await self.app(scope, receive, send)
            return
        bucket = self._bucket(scope.get("method", ""), scope.get("path", ""))
        limit, window_s = self.limits[bucket]
        client = scope.get("client")
        ip = client[0] if client else "unknown"
        now = time.monotonic()
        key = (bucket, ip)
        w = self.windows.get(key)
        if w is None or w.reset_at <= now:
            if len(self.windows) > 10_000:  # drop expired windows now and then
                self.windows = {k: v for k, v in self.windows.items() if v.reset_at > now}
            w = self.windows[key] = _Window(now + window_s)
        w.count += 1
        remaining = max(0, limit - w.count)
        reset_in = max(1, math.ceil(w.reset_at - now))
        rl_headers = [
            (b"x-ratelimit-limit", str(limit).encode()),
            (b"x-ratelimit-remaining", str(remaining).encode()),
            (b"x-ratelimit-reset", str(reset_in).encode()),
        ]

        async def send_wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []), *rl_headers]
            await send(message)

        if w.count > limit:
            await _send_exception(scope, receive, send_wrapped, RateLimitedException(reset_in))
            return
        await self.app(scope, receive, send_wrapped)


class CsrfMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            method = scope.get("method", "")
            path = scope.get("path", "")
            if (
                method not in SAFE_METHODS
                and path.startswith("/api/")
                and path not in CSRF_EXEMPT
                and _header(scope, b"x-requested-with") != "XHR"
            ):
                await _send_exception(scope, receive, send, CsrfHeaderMissingException())
                return
        await self.app(scope, receive, send)


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = _header(scope, b"content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            await _send_exception(scope, receive, send, PayloadTooLargeException())
            return
        seen = 0

        async def receive_capped() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    # Chunked body without a length: FastAPI lets an HTTPException from the
                    # body read through to the problem+json handler as a 413.
                    raise StarletteHTTPException(413)
            return message

        await self.app(scope, receive_capped, send)
