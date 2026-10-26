"""Every 4xx/5xx the API emits is RFC 9457 `application/problem+json`:

    {type, title, status, code, detail?, correlationId, errors?[{field?, code, message}]}

The frontend reads this shape, so it is kept exactly as the API contract defines it (D-109a).
Submitted values are never echoed back, and unexpected errors carry no detail at all.
"""

from collections.abc import Sequence
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import get_logger
from app.exceptions.custom_exceptions import AppException, FieldError

PROBLEM_JSON = "application/problem+json"

TITLES = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
    422: "Unprocessable Content",
    423: "Locked",
    429: "Too Many Requests",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
}

# Pydantic error type -> the stable field-level code the API has always used.
_FIELD_CODES = {
    "missing": "REQUIRED",
    "string_too_short": "MINLENGTH",
    "string_too_long": "MAXLENGTH",
    "string_pattern_mismatch": "PATTERN",
    "literal_error": "ENUM",
    "enum": "ENUM",
    "greater_than_equal": "MINIMUM",
    "greater_than": "EXCLUSIVEMINIMUM",
    "less_than_equal": "MAXIMUM",
    "less_than": "EXCLUSIVEMAXIMUM",
    "too_short": "MINITEMS",
    "too_long": "MAXITEMS",
    "datetime_from_date_parsing": "FORMAT",
    "datetime_parsing": "FORMAT",
    "datetime_type": "FORMAT",
    "timezone_aware": "FORMAT",
    "date_from_datetime_parsing": "FORMAT",
    "date_parsing": "FORMAT",
    "value_error": "FORMAT",
}
_LOCATIONS = {"body", "query", "path", "header", "cookie"}


def correlation_id_of(request: Request) -> str:
    return str(getattr(request.state, "correlation_id", "") or "")


def problem_body(
    correlation_id: str,
    status: int,
    code: str,
    detail: str | None = None,
    errors: Sequence[FieldError] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "type": "about:blank",
        "title": TITLES.get(status, "Error"),
        "status": status,
        "code": code,
        "correlationId": correlation_id,
    }
    if detail is not None:
        body["detail"] = detail
    if errors:
        body["errors"] = [e.to_json() for e in errors]
    return body


def problem_response(
    correlation_id: str,
    status: int,
    code: str,
    detail: str | None = None,
    errors: Sequence[FieldError] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        problem_body(correlation_id, status, code, detail, errors),
        status_code=status,
        media_type=PROBLEM_JSON,
        headers=headers,
    )


def app_exception_response(correlation_id: str, exc: AppException) -> JSONResponse:
    headers = None
    retry_after = getattr(exc, "retry_after", None)
    if retry_after is not None:
        headers = {"Retry-After": str(retry_after)}
    return problem_response(
        correlation_id, exc.status_code, exc.error_code, exc.message, exc.errors, headers
    )


def map_validation_errors(errors: Sequence[Any]) -> list[FieldError]:
    out: list[FieldError] = []
    for e in errors:
        loc = [str(p) for p in e.get("loc", ())]
        if loc and loc[0] in _LOCATIONS:
            loc = loc[1:]
        field = ".".join(loc) or None
        kind = str(e.get("type", ""))
        code = _FIELD_CODES.get(kind)
        if code is None:
            code = kind.upper() if kind.isupper() else "TYPE"
        message = f"{field} is required" if kind == "missing" and field else str(e.get("msg", ""))
        out.append(FieldError(code=code, message=message or "is invalid", field=field))
    return out


async def _on_app_exception(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppException)
    if exc.status_code >= 500:
        get_logger().error("app_error", code=exc.error_code)
    else:
        get_logger().info("refused", code=exc.error_code, status=exc.status_code)
    return app_exception_response(correlation_id_of(request), exc)


async def _on_validation(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    errors = list(exc.errors())
    cid = correlation_id_of(request)
    if any(e.get("type") == "json_invalid" for e in errors):
        get_logger().info("refused", code="BAD_REQUEST", status=400)
        return problem_response(cid, 400, "BAD_REQUEST", "Malformed request body.")
    get_logger().info("refused", code="VALIDATION_FAILED", status=422)
    return problem_response(
        cid, 422, "VALIDATION_FAILED", "Request validation failed.", map_validation_errors(errors)
    )


async def _on_http(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    cid = correlation_id_of(request)
    status = exc.status_code
    # An unknown path and a known path with the wrong method are both "no such route".
    if status in (404, 405):
        return problem_response(cid, 404, "NOT_FOUND", "No such route.")
    if status == 401:
        return problem_response(cid, 401, "UNAUTHENTICATED", "Sign in to continue.")
    if status == 403:
        return problem_response(cid, 403, "FORBIDDEN", "Not allowed.")
    if status == 413:
        return problem_response(
            cid, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds the configured limit."
        )
    if status == 415:
        return problem_response(cid, 415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported content type.")
    if 400 <= status < 500:
        return problem_response(cid, status, "BAD_REQUEST", "Request refused.")
    return internal_error_response(cid)


def internal_error_response(correlation_id: str) -> JSONResponse:
    """Unknown -> 500 with no stack, no message (it may contain paths) and no detail."""
    return problem_response(correlation_id, 500, "INTERNAL")


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppException, _on_app_exception)
    app.add_exception_handler(RequestValidationError, _on_validation)
    app.add_exception_handler(StarletteHTTPException, _on_http)
