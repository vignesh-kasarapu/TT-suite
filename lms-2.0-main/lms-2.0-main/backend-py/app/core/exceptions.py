"""Domain exception + FastAPI exception handlers.

Mirrors backend/src/middleware/error.middleware.js: services raise a plain
AppError(code, message, status) — never an HTTPException (services must not know
about FastAPI/HTTP) — and main.py registers the handlers below to turn any
AppError, or an unmapped SQLAlchemy error, into the same {success:false,error:{...}}
envelope the Node backend already produces.
"""
from fastapi import FastAPI, Request
from sqlalchemy.exc import (
    DataError,
    IntegrityError,
    NoResultFound,
    SQLAlchemyError,
)

from app.core.responses import fail


class AppError(Exception):
    """Raised by services only — routers/DAOs never raise this directly."""

    def __init__(self, code: str, message: str, status: int = 400):
        self.code = code
        self.message = message
        self.status = status
        super().__init__(message)


class NotFoundError(AppError):
    def __init__(self, message: str = "Resource not found."):
        super().__init__("NOT_FOUND", message, status=404)


class PermissionDeniedError(AppError):
    def __init__(self, message: str = "You do not have permission to do this."):
        super().__init__("PERMISSION_DENIED", message, status=403)


class ValidationError(AppError):
    def __init__(self, message: str):
        super().__init__("VALIDATION_ERROR", message, status=400)


def _map_sqlalchemy_error(err: SQLAlchemyError) -> tuple[int, str, str]:
    if isinstance(err, IntegrityError):
        return 409, "DUPLICATE_VALUE", "A record with these values already exists."
    if isinstance(err, DataError):
        return 400, "INVALID_REQUEST", "The request could not be processed with the given values."
    if isinstance(err, NoResultFound):
        return 404, "NOT_FOUND", "Resource not found."
    return 500, "INTERNAL_ERROR", "Something went wrong. Please try again."


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError):
        return fail(exc.status, exc.code, exc.message)

    @app.exception_handler(SQLAlchemyError)
    async def handle_sqlalchemy_error(_request: Request, exc: SQLAlchemyError):
        status, code, message = _map_sqlalchemy_error(exc)
        if status >= 500:
            import logging

            logging.getLogger("uvicorn.error").exception(exc)
        return fail(status, code, message)

    @app.exception_handler(Exception)
    async def handle_unmapped_error(_request: Request, exc: Exception):
        import logging

        logging.getLogger("uvicorn.error").exception(exc)
        return fail(500, "INTERNAL_ERROR", "Something went wrong. Please try again.")
