"""One log line per request through the portal (the suite's only front door), and an Inbox alert
to the global admins when anything answers 5xx.

    request_id=… user=… app=kanban method=GET path=/kanban/api/cards status=200 ms=12 ip=…

The request id is taken from an incoming `X-Request-ID` (or made up), passed on to the app by the
gateway (it forwards request headers) and returned in the response, so one request can be followed
from the browser through the app's own log lines. deploy/run.py writes all of it to the daily file.
"""

import asyncio
import logging
import re
import time
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from sqlalchemy import text

from suite_core import inbox
from suite_core.constants import APP_TITLES, APPS, session_cookie_name
from suite_core.cookies import hash_session_id

Scope = MutableMapping[str, Any]
ASGI = Callable[[Scope, Callable[[], Awaitable[Any]], Callable[[Any], Awaitable[None]]], Awaitable[None]]

access = logging.getLogger("tt.access")
log = logging.getLogger("portal")

QUIET = ("/api/health",)  # probes every few seconds
ALERT_EVERY_S = 600       # at most one Inbox alert per app + method + path pattern in this window
USER_CACHE_S = 60
_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")
_ID_SEGMENT = re.compile(r"^(\d+|[0-9A-HJKMNP-TV-Z]{26}|[0-9a-fA-F-]{16,})$")  # numbers, ULIDs, UUIDs/hex
_SESSION_USER = text(
    "SELECT u.email FROM app.session s JOIN app.users u ON u.id = s.user_id WHERE s.id = :id AND s.expires_at > now()"
)


def app_of(path: str) -> str:
    first = path.split("/", 2)[1] if path.count("/") >= 1 else ""
    return first if first in APPS else "portal"


def pattern_of(path: str) -> str:
    """/kanban/api/cards/01J…/comments -> /kanban/api/cards/:id/comments (alerts group by this)."""
    return "/".join(":id" if _ID_SEGMENT.match(seg) else seg for seg in path.split("/"))


class RequestLogMiddleware:
    def __init__(self, app: ASGI) -> None:
        self.app = app
        self._users: dict[str, tuple[str, float]] = {}
        self._alerted: dict[str, float] = {}
        self._tasks: set[asyncio.Task[None]] = set()  # alerts in flight (kept so they are not collected)

    async def __call__(self, scope: Scope, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        quiet = path in QUIET or "/assets/" in path
        headers = dict(scope["headers"])
        given = headers.get(b"x-request-id", b"").decode("latin-1")
        request_id = given if _REQUEST_ID.fullmatch(given) else uuid.uuid4().hex[:16]
        if not given:
            scope["headers"] = [*scope["headers"], (b"x-request-id", request_id.encode())]
        started = time.perf_counter()
        status = 500

        async def send_with_id(message: Any) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message["headers"] = [*message.get("headers", []), (b"x-request-id", request_id.encode())]
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            log.exception("unhandled error request_id=%s %s %s", request_id, scope["method"], path)
            status = 500
            raise
        finally:
            if not quiet or status >= 500:
                await self._log(scope, headers, request_id, status, started)

    async def _log(self, scope: Scope, headers: dict[bytes, bytes], request_id: str, status: int, started: float) -> None:
        app_state = scope["app"].state
        path, method = scope["path"], scope["method"]
        user = await self._user(app_state, headers)
        line = (f"request_id={request_id} user={user or '-'} app={app_of(path)} method={method} path={path} "
                f"status={status} ms={(time.perf_counter() - started) * 1000:.0f} ip={(scope.get('client') or ('-',))[0]}")
        if status >= 500:
            access.error(line)
            self._alert(app_state, method, path, status, request_id, user)
        else:
            access.info(line)

    async def _user(self, state: Any, headers: dict[bytes, bytes]) -> str | None:
        """The signed-in person's email, from the session cookie (cached for a minute)."""
        name = session_cookie_name(state.settings.APP_PROFILE)
        cookie = next((part.split("=", 1)[1] for part in headers.get(b"cookie", b"").decode("latin-1").split("; ")
                       if part.startswith(f"{name}=")), None)
        if not cookie:
            return None
        key = hash_session_id(cookie)
        hit = self._users.get(key)
        now = time.monotonic()
        if hit and hit[1] > now:
            return hit[0] or None
        try:
            async with state.sessionmaker() as db:
                email = (await db.execute(_SESSION_USER, {"id": key})).scalar() or ""
        except Exception:
            return None
        if len(self._users) > 5000:
            self._users.clear()
        self._users[key] = (email, now + USER_CACHE_S)
        return email or None

    def _alert(self, state: Any, method: str, path: str, status: int, request_id: str, user: str | None) -> None:
        app = app_of(path)
        key = f"{app} {method} {pattern_of(path)}"
        now = time.monotonic()
        if self._alerted.get(key, 0) > now:
            return
        self._alerted[key] = now + ALERT_EVERY_S
        title = f"Error in {APP_TITLES.get(app, 'the dashboard')}: {method} {pattern_of(path)} returned {status}"
        body = (f"Request {request_id}{f' by {user}' if user else ''} at {time.strftime('%Y-%m-%d %H:%M:%S')}. "
                f"The details are in the suite log for today; search it for request_id={request_id}. "
                f"Further errors on this path are not alerted for {ALERT_EVERY_S // 60} minutes.")

        async def deliver() -> None:
            try:
                async with state.sessionmaker() as db:
                    await inbox.anotify_global_admins(db, "error", title, body, None)
                    await db.commit()
            except Exception:
                log.warning("error alert not delivered request_id=%s", request_id)

        task = asyncio.get_running_loop().create_task(deliver())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
