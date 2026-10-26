"""Phase 6 cutover: the existing React frontend (`frontend/`) sends request
bodies/query params as camelCase (its own JS convention), matching Node's
controllers, which read `req.body.workEmail` etc. Every Pydantic schema in
this backend is snake_case (matching DB columns — deliberately chosen back in
Phase 2 to mirror Node's own *response* convention, since Node's GET
responses are themselves snake_case Sequelize model dumps in the overwhelming
majority of cases). This file is the pure key-transform logic; the actual
request rewriting lives in app/core/casing_middleware.py."""
import re
from typing import Any

_CAMEL_BOUNDARY_RE = re.compile(r"(?<!^)(?=[A-Z])")


def camel_to_snake(name: str) -> str:
    """Idempotent on an already-snake_case name (no uppercase to react to) —
    safe to run unconditionally on every request without a frontend-vs-test
    special case."""
    return _CAMEL_BOUNDARY_RE.sub("_", name).lower()


def snake_to_camel(name: str) -> str:
    first, *rest = name.split("_")
    return first + "".join(p[:1].upper() + p[1:] for p in rest if p)


def keys_camel_to_snake(value: Any) -> Any:
    if isinstance(value, dict):
        return {camel_to_snake(k): keys_camel_to_snake(v) for k, v in value.items()}
    if isinstance(value, list):
        return [keys_camel_to_snake(v) for v in value]
    return value


def keys_snake_to_camel(value: Any) -> Any:
    if isinstance(value, dict):
        return {snake_to_camel(k): keys_snake_to_camel(v) for k, v in value.items()}
    if isinstance(value, list):
        return [keys_snake_to_camel(v) for v in value]
    return value
