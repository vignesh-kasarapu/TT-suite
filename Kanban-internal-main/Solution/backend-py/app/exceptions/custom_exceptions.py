"""Application exceptions. Each carries the HTTP status and the stable machine `code` the API
contract documents; `handlers.py` turns every one of them into RFC 9457 problem+json.

Services raise these; controllers never build error responses themselves.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldError:
    """One entry of `errors[]`: which field, a stable code, and a message (never the value)."""

    code: str
    message: str
    field: str | None = None

    def to_json(self) -> dict[str, str]:
        out = {"code": self.code, "message": self.message}
        if self.field is not None:
            out["field"] = self.field
        return out


class AppException(Exception):
    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str | None = None,
        errors: list[FieldError] | None = None,
    ) -> None:
        super().__init__(message or error_code)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.errors = errors


# ---- 400
class BadRequestException(AppException):
    def __init__(self, code: str = "BAD_REQUEST", message: str = "Request refused.") -> None:
        super().__init__(400, code, message)


class OidcStateException(BadRequestException):
    def __init__(self, message: str = "Sign-in state is missing or damaged; start again.") -> None:
        super().__init__("OIDC_STATE", message)


class OidcExchangeException(BadRequestException):
    def __init__(self, message: str) -> None:
        super().__init__("OIDC_EXCHANGE", message)


class OidcClaimsException(BadRequestException):
    def __init__(self, message: str) -> None:
        super().__init__("OIDC_CLAIMS", message)


# ---- 401 / 403
class UnauthenticatedException(AppException):
    def __init__(self) -> None:
        super().__init__(401, "UNAUTHENTICATED", "Sign in to continue.")


class ForbiddenException(AppException):
    def __init__(self, message: str = "Not allowed.", code: str = "FORBIDDEN") -> None:
        super().__init__(403, code, message)


class CsrfHeaderMissingException(ForbiddenException):
    def __init__(self) -> None:
        super().__init__("Missing X-Requested-With: XHR header.", "CSRF_HEADER_MISSING")


class NotAdmittedException(ForbiddenException):
    """D-083: nobody is auto-provisioned; unknown or inactive people are refused."""

    def __init__(self) -> None:
        super().__init__("Ask an admin to add you to Kanban.", "NOT_ADMITTED")


class NoAppAccessException(ForbiddenException):
    """SUITE-CONTRACT §3.1: signed in to the suite, but no Kanban access (or the Kanban account is
    inactive). The frontend sends the person to the portal dashboard (`/?denied=kanban`)."""

    def __init__(self) -> None:
        super().__init__("You do not have access to Kanban.", "NO_APP_ACCESS")


class InternalTokenException(ForbiddenException):
    """SUITE-CONTRACT §3.2: /internal/* without the shared secret (or none is configured)."""

    def __init__(self) -> None:
        super().__init__("Internal call refused.", "INTERNAL_TOKEN")


# ---- 404
class NotFoundException(AppException):
    def __init__(self, message: str = "No such route.") -> None:
        super().__init__(404, "NOT_FOUND", message)


# ---- 409
class NotEmptyException(AppException):
    """D-032: a team, program, project or tag is only deleted when nothing uses it."""

    def __init__(self, message: str) -> None:
        super().__init__(409, "NOT_EMPTY", message)


# ---- 413 / 422 / 429
class PayloadTooLargeException(AppException):
    def __init__(self) -> None:
        super().__init__(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the configured limit.")


class ValidationFailedException(AppException):
    def __init__(self, message: str, errors: list[FieldError] | None = None) -> None:
        super().__init__(422, "VALIDATION_FAILED", message, errors)


class NameTakenException(AppException):
    """D-045: names are unique (case-insensitive); a clash is a field error, not a 500."""

    def __init__(self, what: str) -> None:
        super().__init__(
            422,
            "NAME_TAKEN",
            f"A {what} with that name already exists.",
            [FieldError("NAME_TAKEN", "That name is already in use.", "name")],
        )


class PrivateCardTimeException(AppException):
    """D-116: time is logged on org cards only."""

    def __init__(self) -> None:
        super().__init__(
            422,
            "PRIVATE_CARD_TIME",
            "Time is logged on team (org) cards only; this card is private.",
        )


class ProvisionRefusedException(AppException):
    """SUITE-CONTRACT §3.2: the portal asked for something Kanban's rules refuse."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(422, code, message)


class NotConfiguredException(AppException):
    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(status_code, "NOT_CONFIGURED", message)


class RateLimitedException(AppException):
    def __init__(self, retry_after: int) -> None:
        super().__init__(429, "RATE_LIMITED", "Too many requests; retry after the indicated delay.")
        self.retry_after = retry_after


# ---- 502
class GraphErrorException(AppException):
    def __init__(self, message: str) -> None:
        super().__init__(502, "GRAPH_ERROR", message)
