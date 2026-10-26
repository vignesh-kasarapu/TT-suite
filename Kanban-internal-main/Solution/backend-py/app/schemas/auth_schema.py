"""Identity: provider descriptor, dev sign-in, the user reference."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.common_schema import CamelModel, Email, Id, IdOut, RequestModel
from app.utils.time import UtcDateTime


class AuthConfig(CamelModel):
    provider: Literal["suite"] = Field(
        description="Active identity provider: always the TT Suite portal (SUITE-CONTRACT §3.1)."
    )


class ContactAdminRequest(RequestModel):
    """D-125: a message to the admins from someone who cannot sign in."""

    name: str = Field(min_length=1, max_length=120)
    email: Email = Field(max_length=254, description="Where the admins can reply.")
    message: str = Field(min_length=1, max_length=2000)


class DevSignInRequest(RequestModel):
    user_id: Id = Field(description="Fixture user to sign in as.")


class UserRef(CamelModel):
    id: IdOut
    name: str
    email: str = Field(json_schema_extra={"format": "email"})
    role: Literal["member", "admin"]
    photo_updated_at: UtcDateTime | None = Field(
        default=None,
        description="Null = no picture. Cache-buster for GET /users/{id}/photo.",
    )
    status: Literal["invited", "active", "inactive"] | None = Field(
        default=None, description="D-083 admission state; present on listUsers."
    )


class UserRefList(CamelModel):
    items: list[UserRef]


def user_ref(
    id: str, name: str, email: str, role: str, photo_updated_at: datetime | None
) -> UserRef:
    """A UserRef that serialises photoUpdatedAt (even when null) but not status."""
    return UserRef.model_validate(
        {"id": id, "name": name, "email": email, "role": role, "photoUpdatedAt": photo_updated_at}
    )
