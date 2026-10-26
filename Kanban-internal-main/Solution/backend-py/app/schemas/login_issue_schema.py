"""Administration > Login issues (D-144)."""

from app.schemas.common_schema import CamelModel, Id
from app.utils.time import UtcDateTime


class LoginIssue(CamelModel):
    id: Id
    name: str
    email: str
    message: str
    created_at: UtcDateTime
    resolved_at: UtcDateTime | None
    resolved_by_name: str | None


class LoginIssueList(CamelModel):
    items: list[LoginIssue]
    open: int
