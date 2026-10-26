"""Inbox, reports and the dev-only outbox views."""

from typing import Any, Literal

from pydantic import Field

from app.schemas.card_schema import CardEvent, CardSummary, Number
from app.schemas.common_schema import CamelModel, Id, IdOut, RequestDateTime, RequestModel
from app.utils.time import CalendarDate, UtcDateTime

InboxGroup = Literal[
    "assignments",
    "mentions",
    "status_changes",
    "priority_eta",
    "reassignments",
    "comments",
    "other",
]


# ---- inbox
class InboxItem(CamelModel):
    event: CardEvent
    card: CardSummary
    reason: Literal["assigned", "comment", "mine", "team", "mentioned"] = Field(
        description="Why it is in my inbox; a badge only (CR-15). D-158: `mentioned` = a comment "
        "names me as @[Name](user:<id>)."
    )
    group: InboxGroup
    unread: bool


class InboxGroupTotal(CamelModel):
    group: InboxGroup
    total: int


class InboxPage(CamelModel):
    total: int
    offset: int
    limit: int
    unread: int = Field(description="Unread across the whole inbox; ignores the filters.")
    items: list[InboxItem]
    groups: list[InboxGroupTotal] = Field(description="CR-16 buckets over the filtered set.")


class InboxReadRequest(RequestModel):
    event_ids: list[Id] = Field(min_length=1, max_length=100)


class InboxClearRequest(RequestModel):
    before: RequestDateTime = Field(description="The end of the day the person picked.")


# ---- reports
class ProgressRow(CamelModel):
    id: str | None = Field(description="Group id (null = no project / program / assignee).")
    name: str
    target_date: CalendarDate | None
    by_state: dict[str, int]
    open: int
    delivered: int
    cancelled: int = Field(description="Shown separately, out of the denominator (D-029).")
    no_eta: int
    overdue: int
    effort_hours: Number
    logged_hours: Number


class ProgressReport(CamelModel):
    today: CalendarDate
    period_from: CalendarDate | None = Field(
        default=None,
        alias="from",
        description="D-153: the period asked for (null = all time): cards created or closed in it,"
        " hours logged in it.",
    )
    period_to: CalendarDate | None = Field(default=None, alias="to")
    rows: list[ProgressRow]


class OverdueGroup(CamelModel):
    id: str | None
    name: str
    cards: list[CardSummary]


class OverdueReport(CamelModel):
    today: CalendarDate
    groups: list[OverdueGroup]


# ---- dev only
class NotificationView(CamelModel):
    id: IdOut
    channel: Literal["email", "teams"]
    target_id: IdOut
    kind: Literal[
        "assigned",
        "blocked",
        "comment",
        "closed",
        "invited",
        "time_reminder",
        "time_shortfall",
        "time_shortfall_lead",
        "time_team_report",
        "contact_admin",
    ]
    payload: dict[str, Any]
    created_at: UtcDateTime
    sent_at: UtcDateTime | None
    attempts: int
    last_error: str | None


class NotificationList(CamelModel):
    items: list[NotificationView]


class DrainResult(CamelModel):
    sent: int
    failed: int


class StubMailView(CamelModel):
    id: IdOut
    to: str
    subject: str
    body: str
    created_at: UtcDateTime


class StubMailList(CamelModel):
    items: list[StubMailView]
