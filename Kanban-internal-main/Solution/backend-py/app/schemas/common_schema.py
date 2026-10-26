"""Shared schema building blocks.

- JSON is camelCase on the wire, snake_case in Python.
- Request bodies are validated strictly (no type coercion: "3" is not 3, 1 is not true),
  unknown properties are ignored, and a field is required unless the contract says otherwise.
- PATCH bodies tell "absent" (leave as is) from an explicit `null` (clear it); `null` is only
  accepted on the fields the contract marks nullable.
"""

import re
from datetime import date
from typing import Annotated, Any, ClassVar

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
)
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

# The email format the API has always accepted (ajv-formats "email"), case-insensitive.
_EMAIL = re.compile(
    r"^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$",
    re.IGNORECASE,
)


def _email(value: str) -> str:
    if not _EMAIL.match(value):
        raise PydanticCustomError("FORMAT", 'must match format "email"')
    return value


Email = Annotated[str, AfterValidator(_email), Field(json_schema_extra={"format": "email"})]

ULID_PATTERN = r"^[0-9A-HJKMNP-TV-Z]{26}$"

# A ULID in a request (validated) and in a response (documented only: stored ids are trusted).
Id = Annotated[str, Field(pattern=ULID_PATTERN, description="Opaque ULID.")]
IdOut = Annotated[
    str, Field(description="Opaque ULID.", json_schema_extra={"pattern": ULID_PATTERN})
]

# Request dates arrive as JSON strings: parsed (and format-checked) despite strict bodies.
RequestDateTime = Annotated[AwareDatetime, Field(strict=False)]
RequestDate = Annotated[date, Field(strict=False)]


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )


class RequestModel(CamelModel):
    model_config = ConfigDict(strict=True, extra="ignore")


class PatchModel(RequestModel):
    """Every field optional; `NULLABLE` lists the (snake_case) fields that may be sent as null."""

    NULLABLE: ClassVar[frozenset[str]] = frozenset()

    @field_validator("*", mode="before")
    @classmethod
    def _reject_null(cls, value: Any, info: ValidationInfo) -> Any:
        if value is None and info.field_name not in cls.NULLABLE:
            raise PydanticCustomError("type", "{field} may not be null", {"field": info.field_name})
        return value


class Problem(BaseModel):
    """RFC 9457 problem details with a stable machine code (documentation of error bodies)."""

    type: str
    title: str
    status: int
    code: str = Field(description="Stable machine code, e.g. STALE_VERSION, FORBIDDEN.")
    detail: str | None = None
    correlationId: str  # noqa: N815 - wire name
    errors: list[dict[str, str]] | None = None


def problem_responses(*statuses: int) -> dict[int | str, dict[str, Any]]:
    """`responses=` entries documenting problem+json errors on an operation."""
    return {s: {"model": Problem, "content": {"application/problem+json": {}}} for s in statuses}
