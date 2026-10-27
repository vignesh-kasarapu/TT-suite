"""Profile (D-064c): own picture, plus the best-effort Graph sync at sign-in. The display name
is the suite's (synced when the person is resolved, SuiteService.ensure_local).

The picture arrives as a data URL the SPA already resized (<= 256 px); the database caps it at
256 KB. There is no server-side image processing.
"""

import base64
import binascii
import re

from app.core.clock import Clock
from app.core.database import UnitOfWork
from app.core.security import Actor
from app.exceptions.custom_exceptions import (
    FieldError,
    NotFoundException,
    ValidationFailedException,
)
from app.integrations.graph import GraphClient
from app.repositories.user_repository import PhotoRow, UserRepository
from app.schemas.auth_schema import UserRef, user_ref

MAX_PHOTO = 262144
PHOTO_TYPES = ("image/jpeg", "image/png", "image/webp")
_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$")


def decode_data_url(data_url: str) -> tuple[str, bytes]:
    """data:image/jpeg;base64,... -> (type, bytes), or 422."""
    m = _DATA_URL.match(data_url)
    if not m:
        raise ValidationFailedException(
            "The picture must be a JPEG, PNG or WebP data URL.",
            [FieldError("FORMAT", "data:image/(jpeg|png|webp);base64,...", "dataUrl")],
        )
    payload = m.group(2)
    try:
        data = base64.b64decode(payload + "=" * (-len(payload) % 4))
    except (binascii.Error, ValueError):
        data = b""
    if not data or len(data) > MAX_PHOTO:
        raise ValidationFailedException(
            "The picture must be between 1 byte and 256 KB.",
            [FieldError("SIZE", "Up to 256 KB after resizing.", "dataUrl")],
        )
    return m.group(1), data


class ProfileService:
    def __init__(
        self,
        uow: UnitOfWork,
        users: UserRepository,
        clock: Clock,
        graph: GraphClient | None = None,
    ) -> None:
        self.uow = uow
        self.users = users
        self.clock = clock
        self.graph = graph

    async def set_photo(self, actor: Actor, data_url: str) -> UserRef:
        photo_type, data = decode_data_url(data_url)
        row = await self.users.set_photo(actor.id, data, photo_type, "user", self.clock.now())
        await self.uow.commit()
        return user_ref(row.id, row.name, row.email, row.role, row.photo_updated_at)

    async def delete_photo(self, actor: Actor) -> None:
        await self.users.clear_photo(actor.id, self.clock.now())
        await self.uow.commit()

    async def photo_of(self, user_id: str) -> PhotoRow:
        photo = await self.users.active_photo(user_id)
        if photo is None:
            raise NotFoundException("No picture.")
        return photo

    async def sync_from_graph(self, user_id: str, oid: str) -> None:
        """Name (unless overridden) and picture (unless the person uploaded their own) from
        Graph. Decoration only: sign-in never depends on Graph being reachable."""
        if self.graph is None or not self.graph.configured:
            return
        try:
            name_override, photo_source = await self.users.sync_flags(user_id)
            now = self.clock.now()
            if not name_override:
                name = await self.graph.display_name(oid)
                if name:
                    await self.users.set_synced_name(user_id, name, now)
            if photo_source != "user":
                got = await self.graph.photo(oid)
                if got and got[0] in PHOTO_TYPES and len(got[1]) <= MAX_PHOTO:
                    await self.users.set_photo(user_id, got[1], got[0], "synced", now)
            await self.uow.commit()
        except Exception:  # best effort by design
            await self.uow.rollback()
