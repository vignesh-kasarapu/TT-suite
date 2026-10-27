"""Org plane: users, teams, programs, projects, tags, and their event history."""

from typing import Annotated, Any, ClassVar, Literal

from pydantic import BeforeValidator, Field
from pydantic_core import PydanticCustomError

from app.schemas.auth_schema import UserRef
from app.schemas.common_schema import (
    CamelModel,
    Id,
    IdOut,
    PatchModel,
    RequestDate,
    RequestModel,
)
from app.utils.time import CalendarDate, UtcDateTime

CARD_KEY_PATTERN = r"^K-[0-9]{1,9}$"
DateConflict = Literal["shrink_project", "extend_program"]


def _date_string(value: Any) -> Any:
    """A calendar date arrives as a JSON string; numbers are not dates here."""
    if value is not None and not isinstance(value, str):
        raise PydanticCustomError("date_type", "must be a YYYY-MM-DD string")
    return value


DateField = Annotated[RequestDate, BeforeValidator(_date_string)]


# ---- shared
class NameRef(CamelModel):
    id: IdOut
    name: str


class OrgEvent(CamelModel):
    id: IdOut
    group_id: IdOut
    field: str
    old_value: Any = Field(description="null when none.")
    new_value: Any = Field(description="null when none.")
    actor: UserRef
    created_at: UtcDateTime


class OrgEventPage(CamelModel):
    total: int
    offset: int
    limit: int
    items: list[OrgEvent]


# ---- users
class UserList(CamelModel):
    items: list[UserRef]


SuiteRole = Literal["member", "lead", "admin"]


class RoleChangeRequest(RequestModel):
    """Only the global admin assigns roles (TT Suite): a Kanban admin asks for a change."""

    role: SuiteRole | None = Field(description="The Kanban role asked for; null = no access.")
    team_ids: list[Id] = Field(
        default_factory=list, max_length=100, description="Teams to lead; required for lead."
    )
    note: str = Field(default="", max_length=1000, description="Why, for the global admin.")


class RoleRequestCreated(CamelModel):
    id: int


class RoleRequest(CamelModel):
    id: int
    email: str
    role: SuiteRole | None = Field(description="null = no access.")
    requested_at: UtcDateTime
    requested_by: str | None = Field(description="Name of the person who asked.")


class RoleRequestList(CamelModel):
    items: list[RoleRequest]


# ---- teams
class Team(CamelModel):
    id: IdOut
    name: str = Field(max_length=80)
    description: str
    member_count: int
    is_member: bool
    teams_webhook: Literal["set", "not_set"]
    created_at: UtcDateTime
    updated_at: UtcDateTime


class TeamMember(UserRef):
    is_lead: bool


class TeamDetail(Team):
    members: list[TeamMember]


class TeamList(CamelModel):
    items: list[Team]


class CreateTeamRequest(RequestModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)


class UpdateTeamRequest(PatchModel):
    NULLABLE: ClassVar[frozenset[str]] = frozenset({"teams_webhook_url"})

    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=2000)
    teams_webhook_url: str | None = Field(
        default=None,
        max_length=2048,
        pattern=r"^https://",
        description="Stored encrypted, never returned (D-075); null removes it.",
    )


class Reassignment(RequestModel):
    key: str = Field(pattern=CARD_KEY_PATTERN)
    assignee_id: Id


class RemoveMemberRequest(RequestModel):
    reassignments: list[Reassignment] = Field(default_factory=list, max_length=500)


class RemovalResult(CamelModel):
    reassigned: int
    released: int


# ---- programs and projects
class Program(CamelModel):
    id: IdOut
    name: str = Field(max_length=120)
    description: str = Field(max_length=5000)
    target_date: CalendarDate | None
    derived_target_date: CalendarDate | None = Field(description="computed (D-029).")
    project_count: int
    created_at: UtcDateTime
    updated_at: UtcDateTime


class Project(CamelModel):
    id: IdOut
    name: str = Field(max_length=120)
    description: str = Field(max_length=5000)
    team: NameRef
    program: NameRef | None
    target_date: CalendarDate | None
    accepting: bool
    closed_at: UtcDateTime | None
    closed_by: UserRef | None
    open_card_count: int
    card_count: int
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ProgramDetail(Program):
    projects: list[Project]


class ProgramList(CamelModel):
    items: list[Program]


class ProjectList(CamelModel):
    items: list[Project]


class CreateProgramRequest(RequestModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=5000)
    target_date: DateField | None = None


class UpdateProgramRequest(PatchModel):
    NULLABLE: ClassVar[frozenset[str]] = frozenset({"target_date"})

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    target_date: DateField | None = None
    date_conflict: DateConflict | None = None


class CreateProjectRequest(RequestModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=5000)
    team_id: Id
    program_id: Id | None = None
    target_date: DateField | None = None
    date_conflict: DateConflict | None = None


class UpdateProjectRequest(PatchModel):
    NULLABLE: ClassVar[frozenset[str]] = frozenset({"program_id", "target_date"})

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    team_id: Id | None = None
    program_id: Id | None = None
    target_date: DateField | None = None
    date_conflict: DateConflict | None = None
    accepting: bool | None = None


class ClosureCard(RequestModel):
    key: str = Field(pattern=CARD_KEY_PATTERN)
    state: Literal["cancelled", "delivered"]


class CloseProjectRequest(RequestModel):
    comment: str = Field(min_length=1, max_length=5000)
    cards: list[ClosureCard] = Field(description="Every open card, closed as given (CR-12).")


# ---- tags
class Tag(CamelModel):
    id: IdOut
    name: str = Field(max_length=40)
    card_count: int
    created_at: UtcDateTime


class TagList(CamelModel):
    items: list[Tag]


class TagNameRequest(RequestModel):
    name: str = Field(min_length=1, max_length=40)
