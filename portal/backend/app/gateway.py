"""The suite's front door on the one App Service port (the B1 plan has no nginx and the budget no
container registry, so the portal itself routes):

    /<app>/api/...  -> http://127.0.0.1:<app port>/api/...   (prefix stripped, streamed)
    /<app>/...      -> the app's built SPA (index.html for client routes)
    /...            -> the portal SPA

`/internal/*` of the apps is never reachable from here. Static files are served from
STATIC_DIR/<app>; hashed assets are cached for a year, index.html never.
"""

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from starlette.background import BackgroundTask

from app.core.config import Settings
from suite_core.constants import active_apps

HOP_BY_HOP = frozenset(
    {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
     "transfer-encoding", "upgrade", "host", "content-length"}
)
# /<app>/api/* -> the app; /<app>/* -> its built SPA. Only this deployment's apps (SUITE_SKIP):
# a skipped app's /<app>/ falls through to the portal SPA (the dashboard).
METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
PORTAL_CSP = (
    "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; "
    "img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com"
)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


async def proxy(request: Request, app_name: str, rest: str) -> Response:
    settings: Settings = request.app.state.settings
    http: httpx.AsyncClient = request.app.state.proxy_http
    target = f"{settings.app_url(app_name)}/api/{rest}"
    headers = [(k, v) for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP]
    prior = request.headers.get("x-forwarded-for")
    ip = _client_ip(request)
    headers = [(k, v) for k, v in headers if k.lower() not in ("x-forwarded-for", "x-forwarded-prefix", "x-forwarded-proto")]
    headers += [
        ("x-forwarded-for", f"{prior}, {ip}" if prior else ip),
        ("x-forwarded-proto", request.headers.get("x-forwarded-proto", request.url.scheme)),
        ("x-forwarded-prefix", f"/{app_name}"),
    ]
    upstream_req = http.build_request(
        request.method, target, params=request.query_params, headers=headers, content=request.stream()
    )
    try:
        upstream = await http.send(upstream_req, stream=True)
    except httpx.HTTPError:
        return Response(
            '{"code":"APP_UNAVAILABLE","detail":"The app is starting or unavailable; try again shortly."}',
            status_code=503, media_type="application/json",
        )
    out_headers = [(k, v) for k, v in upstream.headers.multi_items() if k.lower() not in HOP_BY_HOP]

    async def body() -> AsyncIterator[bytes]:
        # Raw bytes: a gzip body stays gzip and its content-encoding header stays true.
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        except httpx.StreamConsumed:  # an in-memory transport (tests) hands back a read body
            yield upstream.content

    response = StreamingResponse(body(), status_code=upstream.status_code, background=BackgroundTask(upstream.aclose))
    response.raw_headers = [(k.lower().encode("latin-1"), v.encode("latin-1")) for k, v in out_headers]
    return response


def _spa_file(root: Path, rest: str) -> Path | None:
    """The asked-for file inside `root`, or index.html for client-side routes; None if unbuilt."""
    if rest:
        candidate = (root / rest).resolve()
        if candidate.is_file() and root.resolve() in candidate.parents:
            return candidate
        if "." in rest.rsplit("/", 1)[-1]:
            return None  # a missing asset is a 404, not the app shell
    index = root / "index.html"
    return index if index.is_file() else None


def spa_response(root: Path, rest: str, csp: str | None) -> Response:
    path = _spa_file(root, rest)
    if path is None:
        return Response("Not found", status_code=404, media_type="text/plain")
    immutable = "/assets/" in path.as_posix() and path.name != "index.html"
    headers = {"cache-control": "public, max-age=31536000, immutable" if immutable else "no-cache"}
    if csp and path.name == "index.html":
        headers["content-security-policy"] = csp
    return FileResponse(path, headers=headers)


def mount(app: FastAPI, settings: Settings) -> None:
    static = Path(settings.STATIC_DIR)

    for name in active_apps():
        async def api(request: Request, rest: str = "", _name: str = name) -> Response:
            return await proxy(request, _name, rest)

        async def bare(_name: str = name) -> Response:
            return RedirectResponse(f"/{_name}/", status_code=308)

        async def spa(rest: str = "", _name: str = name) -> Response:
            # Kanban keeps the CSP it always had; LMS and EMS shells carry an inline pre-paint script.
            return spa_response(static / _name, rest, PORTAL_CSP if _name == "kanban" else None)

        app.add_api_route(f"/{name}/api/{{rest:path}}", api, methods=METHODS, include_in_schema=False)
        app.add_api_route(f"/{name}", bare, methods=["GET"], include_in_schema=False)
        app.add_api_route(f"/{name}/{{rest:path}}", spa, methods=["GET", "HEAD"], include_in_schema=False)

    async def portal_spa(rest: str = "") -> Response:
        if rest.startswith("api/"):
            return Response('{"code":"NOT_FOUND","detail":"Not found."}', status_code=404, media_type="application/json")
        return spa_response(static / "portal", rest, PORTAL_CSP)

    app.add_api_route("/{rest:path}", portal_spa, methods=["GET", "HEAD"], include_in_schema=False)
