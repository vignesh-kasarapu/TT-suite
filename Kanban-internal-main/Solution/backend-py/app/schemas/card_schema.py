"""Cards: the card, its summary, boards, search, history, comments, links, time entries,
attachments and dependency trees."""

from typing import Annotated, Any, ClassVar, Literal

from pydantic import BaseModel, Field

from app.schemas.auth_schema import UserRef
from app.schemas.common_schema import CamelModel, Id, IdOut, PatchModel, RequestModel
from app.schemas.org_schema import CARD_KEY_PATTERN, DateField
from app.utils.time import CalendarDate, UtcDateTime

CardState = Literal[
    "backlog", "in_prep", "ready", "in_development", "uat", "delivered", "cancelled"
]
Plane = Literal["private", "org"]
LinkType = Literal["relates_to", "depends_on", "blocks"]
AttachmentKind = Literal["document", "design", "spec", "other"]
# Numbers keep their JSON form: 2 stays 2, 1.5 stays 1.5.
Number = int | float
CardKey = Annotated[str, Field(pattern=CARD_KEY_PATTERN, description="Card key `K-<number>`.")]
Priority = Annotated[int, Field(ge=1, le=4)]
TagList = Annotated[list[Annotated[str, Field(min_length=1, max_length=40)]], Field(max_length=20)]


# ---- responses
class Card(CamelModel):
    id: IdOut
    key: str = Field(json_schema_extra={"pattern": CARD_KEY_PATTERN})
    number: int
    title: str = Field(max_length=200)
    description: str = Field(max_length=20000)
    plane: Plane
    state: CardState
    owner_id: IdOut
    assignee_id: IdOut | None = Field(
        description="Who is working on it (D-049); an admin may hold any org card (CR-17)."
    )
    team_id: IdOut | None = Field(description="Always null on the private plane.")
    project_id: IdOut | None
    priority: int | None
    tags: list[str]
    eta: CalendarDate | None
    effort_hours: Number | None
    closed_at: UtcDateTime | None
    logged_hours: Number = Field(
        description="Sum of the time entries the caller may see (D-071, CR-13)."
    )
    version: int
    created_at: UtcDateTime
    updated_at: UtcDateTime
    can_move: bool = Field(
        description="D-117: whether the caller may move this card to another state "
        "(its assignee, a lead of its team, an admin; a private card's owner)."
    )
    overdue: bool = Field(
        description="D-152: open and its ETA is before today in the org time zone (the rule the "
        "reports count overdue cards by)."
    )


class CardSummary(CamelModel):
    id: IdOut
    key: str
    title: str
    plane: Plane
    state: CardState
    priority: int | None
    team_id: IdOut | None
    project_id: IdOut | None
    assignee_id: IdOut | None
    eta: CalendarDate | None
    closed_at: UtcDateTime | None


class BoardColumns(BaseModel):
    """Keyed by state name, exactly as the states are spelled."""

    backlog: list[Card]
    in_prep: list[Card]
    ready: list[Card]
    in_development: list[Card]
    uat: list[Card]
    delivered: list[Card]
    cancelled: list[Card]


class Board(CamelModel):
    columns: BoardColumns = Field(description="One entry per state, cards in board order.")


class CardSearchPage(CamelModel):
    total: int
    offset: int
    limit: int
    items: list[CardSummary]


class CardEvent(CamelModel):
    id: IdOut
    group_id: IdOut
    field: str
    old_value: Any = Field(description="Previous value (JSON), null when none.")
    new_value: Any = Field(description="New value (JSON), null when none.")
    actor: UserRef
    created_at: UtcDateTime
    copied_from_key: str | None = Field(description="Set on rows carried over by a copy.")
    limited_team: str | None = Field(
        default=None, description="CR-28: the team of an unreadable card the event points at."
    )


class CardEventPage(CamelModel):
    total: int
    offset: int
    limit: int
    items: list[CardEvent]


class Comment(CamelModel):
    id: IdOut
    card_id: IdOut
    author: UserRef
    body: str
    created_at: UtcDateTime
    edited_at: UtcDateTime | None
    copied_from_key: str | None
    parent_id: IdOut | None
    up: int
    down: int
    my_vote: Literal[-1, 0, 1]


class CommentList(CamelModel):
    items: list[Comment]


class CardLink(CamelModel):
    id: IdOut
    type: LinkType
    direction: Literal["out", "in"]
    card: CardSummary
    active: bool | None = Field(description="blocks only: true while the blocking card is open.")
    created_at: UtcDateTime


class CardLinkList(CamelModel):
    items: list[CardLink]


class TimeEntry(CamelModel):
    id: IdOut
    user: UserRef
    date: CalendarDate
    hours: Number
    note: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


class TimeEntryList(CamelModel):
    total: Number
    scope: Literal["all", "own"]
    items: list[TimeEntry]


class Attachment(CamelModel):
    id: IdOut
    title: str
    url: str
    kind: AttachmentKind | None
    note: str
    added_by: UserRef
    added_at: UtcDateTime


class AttachmentList(CamelModel):
    items: list[Attachment]


class CardDocuments(CamelModel):
    card: CardSummary
    items: list[Attachment]


class ProjectDocuments(CamelModel):
    common: list[Attachment]
    by_card: list[CardDocuments]


class TreeNode(CardSummary):
    external: bool = Field(description="Outside the project/program, linked to one inside.")


class TreeEdge(CamelModel):
    link_id: IdOut
    from_id: IdOut
    to_id: IdOut


class DependencyTree(CamelModel):
    nodes: list[TreeNode]
    edges: list[TreeEdge]
    cycles: list[list[IdOut]] = Field(description="Strongly connected components > 1 (FR-033).")


# ---- requests
class CardCreateRequest(PatchModel):
    """`assigneeId` left out means the creator (CR-17); an explicit null means nobody."""

    NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {
            "team_id",
            "project_id",
            "assignee_id",
            "depends_on_key",
            "priority",
            "eta",
            "effort_hours",
        }
    )

    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20000)
    plane: Plane | None = None
    team_id: Id | None = None
    project_id: Id | None = None
    assignee_id: Id | None = None
    depends_on_key: str | None = Field(default=None, pattern=CARD_KEY_PATTERN)
    state: CardState | None = None
    priority: Priority | None = None
    tags: TagList | None = None
    eta: DateField | None = None
    effort_hours: float | None = Field(default=None, ge=0)


class CardPatchRequest(PatchModel):
    NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"team_id", "project_id", "assignee_id", "priority", "eta", "effort_hours"}
    )

    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20000)
    assignee_id: Id | None = None
    team_id: Id | None = None
    project_id: Id | None = None
    priority: Priority | None = None
    tags: TagList | None = None
    eta: DateField | None = None
    effort_hours: float | None = Field(default=None, ge=0)


class MoveRequest(RequestModel):
    state: CardState
    version: int = Field(ge=1)


class CardCopyRequest(PatchModel):
    NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"team_id", "project_id", "assignee_id", "priority", "eta", "effort_hours"}
    )

    target_plane: Plane
    version: int = Field(ge=1, description="Current version of the source card.")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20000)
    state: CardState | None = None
    assignee_id: Id | None = None
    team_id: Id | None = None
    project_id: Id | None = None
    priority: Priority | None = None
    tags: TagList | None = None
    eta: DateField | None = None
    effort_hours: float | None = Field(default=None, ge=0)
    comment_ids: list[Id] = Field(max_length=1000, description="Source comments to carry over.")
    event_ids: list[Id] = Field(max_length=5000, description="Source events to carry over.")
    cancel_source: bool | None = Field(
        default=None, description="Private -> org only: cancel the source in the same step."
    )


class CommentBody(PatchModel):
    NULLABLE: ClassVar[frozenset[str]] = frozenset({"parent_id"})

    body: str = Field(min_length=1, max_length=10000)
    parent_id: Id | None = Field(default=None, description="On add only: reply to this comment.")


class VoteRequest(RequestModel):
    value: Literal[-1, 0, 1]


class LinkCreateRequest(RequestModel):
    type: LinkType
    target_key: CardKey


class TimeEntryBody(RequestModel):
    date: DateField
    hours: float = Field(gt=0, le=24, description="CR-21: at most 24 h per person per date.")
    note: str | None = Field(default=None, max_length=500)


class AttachmentCreate(PatchModel):
    NULLABLE: ClassVar[frozenset[str]] = frozenset({"kind"})

    title: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=8, max_length=2048, pattern=r"^[Hh][Tt][Tt][Pp][Ss]?://")
    kind: AttachmentKind | None = None
    note: str | None = Field(default=None, max_length=1000)
