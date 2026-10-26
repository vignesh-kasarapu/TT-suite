"""Phase 6 cutover shim — see casing.py's module docstring for why this
exists. Rewrites incoming camelCase query-string keys and JSON body keys to
snake_case before routing/validation sees them, so every existing Pydantic
schema (already snake_case) needs zero per-field aliases. Deliberately does
NOT touch multipart/form-data bodies (avatar/attachment/bulk-import uploads)
— only `application/json` bodies are JSON-parsed and rewritten; anything else
passes through completely untouched, binary-safe.

Implemented as a raw ASGI middleware, not `BaseHTTPMiddleware` — that class's
`call_next` closes over the *original* ASGI `receive` channel internally, so
constructing a new Starlette `Request` and handing it to `call_next` does NOT
actually forward a modified body downstream (a well-known gotcha). Wrapping
`receive` directly, as below, is the documented-correct way to rewrite a
request body in Starlette/FastAPI.
"""
import json
from urllib.parse import parse_qsl, urlencode

from app.core.casing import camel_to_snake, keys_camel_to_snake


class ClientCasingMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        scope = dict(scope)

        query_string = scope.get("query_string", b"")
        if query_string:
            pairs = parse_qsl(query_string.decode(), keep_blank_values=True)
            scope["query_string"] = urlencode([(camel_to_snake(k), v) for k, v in pairs]).encode()

        method = scope.get("method")
        headers = dict(scope.get("headers") or [])
        content_type = headers.get(b"content-type", b"").decode()

        # DELETE is included because the client sends a JSON body on at least one of them
        # (revoking an employee role). Leaving it out meant that body reached Pydantic
        # still camelCase and failed validation, while every other verb worked.
        if method in ("POST", "PATCH", "PUT", "DELETE") and "application/json" in content_type:
            body = b""
            more_body = True
            while more_body:
                message = await receive()
                body += message.get("body", b"")
                more_body = message.get("more_body", False)

            if body:
                try:
                    body = json.dumps(keys_camel_to_snake(json.loads(body))).encode()
                except json.JSONDecodeError:
                    pass  # malformed JSON — let Pydantic's own validation produce the error

            async def receive():  # noqa: F811 — deliberate shadow, replaces the drained channel
                return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, receive, send)
