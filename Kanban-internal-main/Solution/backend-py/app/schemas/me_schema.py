"""The current user: context, preferences, profile and picture."""

from typing import ClassVar, Literal

from pydantic import Field

from app.schemas.auth_schema import UserRef
from app.schemas.common_schema import CamelModel, Id, IdOut, PatchModel, RequestModel
from app.utils.time import UtcDateTime

Theme = Literal["light", "dark", "system"]
OrgOrder = Literal["team_first", "project_first"]


class TeamRef(CamelModel):
    id: IdOut
    name: str = Field(max_length=80)


class Me(CamelModel):
    user: UserRef
    session_expires_at: UtcDateTime
    teams: list[TeamRef] = Field(description="Teams the caller belongs to.")
    lead_team_ids: list[IdOut] = Field(description="Teams the caller leads (CR-11).")
    inbox_unread: int = Field(description="Unread inbox items (D-066); drives the nav badge.")


class Preferences(CamelModel):
    theme: Theme
    accent: str = Field(max_length=40)
    notify_email: bool = Field(description="FR-045 opt-in: email on assigned / blocked.")
    primary_team_id: IdOut | None = Field(description="D-077 default team (one of mine).")
    primary_project_id: IdOut | None = Field(
        description="D-077 default project (in one of my teams)."
    )
    org_order: OrgOrder = Field(description="Which default comes first on the Org tab.")
    inbox_window_days: int = Field(
        ge=1, le=365, description="CR-19: how far back my inbox reaches."
    )


class PreferencesPatch(PatchModel):
    NULLABLE: ClassVar[frozenset[str]] = frozenset({"primary_team_id", "primary_project_id"})

    theme: Theme | None = None
    accent: str | None = Field(default=None, max_length=40)
    notify_email: bool | None = None
    primary_team_id: Id | None = None
    primary_project_id: Id | None = None
    org_order: OrgOrder | None = None
    inbox_window_days: int | None = Field(default=None, ge=1, le=365)


class ProfileUpdateRequest(RequestModel):
    name: str = Field(min_length=1, max_length=120, description="Display name (D-064c).")


class PhotoUpdateRequest(RequestModel):
    data_url: str = Field(
        max_length=360000,
        pattern=r"^data:image/(jpeg|png|webp);base64,",
        description="Picture the SPA resized: JPEG, PNG or WebP data URL, <= 256 KB.",
    )
