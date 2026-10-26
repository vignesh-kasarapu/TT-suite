"""Mirrors backend/src/utils/apiResponse.js exactly — every endpoint in this app
returns one of these three shapes, so the existing frontend/src/api/client.js
response interceptor (which unwraps `res.data` and reads `error.code`/`error.message`)
keeps working unmodified against this backend."""
from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse


def ok(data: Any, meta: dict | None = None, status_code: int = 200) -> JSONResponse:
    body: dict[str, Any] = {"success": True, "data": data}
    if meta is not None:
        body["meta"] = meta
    # jsonable_encoder (not plain json.dumps, which JSONResponse uses by default)
    # so date/datetime/Decimal values from Pydantic model_dump()s serialize —
    # every admin endpoint with a date field would otherwise 500 on render.
    return JSONResponse(status_code=status_code, content=jsonable_encoder(body))


def created(data: Any) -> JSONResponse:
    return ok(data, status_code=201)


def fail(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error": {"code": code, "message": message}},
    )
