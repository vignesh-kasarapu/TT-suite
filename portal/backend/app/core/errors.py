"""Portal errors: services raise `AppError`; the handler answers `{code, detail}` JSON with the
status. Unexpected errors answer 500 with no detail (never a stack or a submitted value)."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("portal")


class AppError(Exception):
    def __init__(self, status: int, code: str, detail: str = "") -> None:
        super().__init__(detail or code)
        self.status = status
        self.code = code
        self.detail = detail


def unauthenticated() -> AppError:
    return AppError(401, "UNAUTHENTICATED", "Sign in first.")


def forbidden(detail: str = "Only the global admin can do that.") -> AppError:
    return AppError(403, "FORBIDDEN", detail)


def not_found(detail: str = "Not found.") -> AppError:
    return AppError(404, "NOT_FOUND", detail)


def register(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, err: AppError) -> JSONResponse:
        return JSONResponse({"code": err.code, "detail": err.detail}, status_code=err.status)

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, err: RequestValidationError) -> JSONResponse:
        fields = [".".join(str(p) for p in e["loc"][1:]) for e in err.errors()]
        return JSONResponse(
            {"code": "VALIDATION", "detail": f"Check: {', '.join(f for f in fields if f) or 'the request'}."},
            status_code=422,
        )

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, err: Exception) -> JSONResponse:
        log.exception("unexpected", exc_info=err)
        return JSONResponse({"code": "INTERNAL", "detail": "Something went wrong."}, status_code=500)
