from datetime import datetime, timezone
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorResponse(BaseModel):
    status: int
    message: str
    timestamp: str
    # TT Suite: a machine-readable reason where the UI acts on it (e.g. NO_APP_ACCESS, UNAUTHENTICATED)
    code: str | None = None


def current_iso_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_error_payload(status: int, message: str) -> dict:
    return {
        "status": status,
        "message": message,
        "timestamp": current_iso_timestamp(),
    }


class AppException(Exception):
    def __init__(self, status: int, message: str, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.code = code
        self.timestamp = current_iso_timestamp()


class BadRequestException(AppException):
    def __init__(self, message: str = "Bad request") -> None:
        super().__init__(status=400, message=message)


class UnauthorizedException(AppException):
    def __init__(self, message: str = "Unauthenticated") -> None:
        super().__init__(status=401, message=message)


class ForbiddenException(AppException):
    def __init__(self, message: str = "Forbidden: insufficient role permissions") -> None:
        super().__init__(status=403, message=message)


class NotFoundException(AppException):
    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(status=404, message=message)


class ConflictException(AppException):
    def __init__(self, message: str = "Business rule conflict") -> None:
        super().__init__(status=409, message=message)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppException)
    async def app_exception_handler(_request: Request, exc: AppException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status,
            content={
                "status": exc.status,
                "message": exc.message,
                "timestamp": exc.timestamp,
                **({"code": exc.code} if exc.code else {}),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = exc.errors()
        messages = []
        for err in errors:
            loc = ".".join(str(part) for part in err.get("loc", []) if part != "body")
            msg = err.get("msg", "Invalid input")
            messages.append(f"{loc}: {msg}" if loc else msg)
        summary = "; ".join(messages) if messages else "Validation error"
        return JSONResponse(
            status_code=400,
            content=build_error_payload(400, summary),
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        status_code = exc.status_code
        message = str(exc.detail) if exc.detail else "HTTP error"
        return JSONResponse(
            status_code=status_code,
            content=build_error_payload(status_code, message),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_request: Request, _exc: Exception) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content=build_error_payload(500, "Internal server error"),
        )
