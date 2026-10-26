"""SQL for `app_user` rows: identity, profile, the boot seed and user administration."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppUser


@dataclass(frozen=True)
class UserRefRow:
    id: str
    name: str
    email: str
    role: str
    photo_updated_at: datetime | None


@dataclass(frozen=True)
class PhotoRow:
    photo: bytes
    photo_type: str
    photo_updated_at: datetime


@dataclass(frozen=True)
class UserRow:
    id: str
    name: str
    email: str
    role: str
    status: str
    photo_updated_at: datetime | None


@dataclass(frozen=True)
class SuiteLinkRow:
    """What the suite sign-in and provisioning need of a person (SUITE-CONTRACT §3)."""

    id: str
    name: str
    email: str
    role: str
    status: str
    external_id: str | None
    suite_user_id: str | None


_REF = (AppUser.id, AppUser.name, AppUser.email, AppUser.role, AppUser.photo_updated_at)
_ROW = (*_REF[:4], AppUser.status, AppUser.photo_updated_at)
_LINK = (
    AppUser.id,
    AppUser.name,
    AppUser.email,
    AppUser.role,
    AppUser.status,
    AppUser.external_id,
    AppUser.suite_user_id,
)


class UserRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def find_status_by_id(self, user_id: str) -> tuple[str, str, str] | None:
        """(id, email, status)."""
        row = (
            await self.db.execute(
                select(AppUser.id, AppUser.email, AppUser.status).where(AppUser.id == user_id)
            )
        ).first()
        return (row.id, row.email, row.status) if row else None

    async def find_admission(
        self, *, user_id: str | None, external_id: str | None, email: str
    ) -> tuple[str, str] | None:
        """(id, status) by id, else by Entra object id, else by email (case-insensitive)."""
        base = select(AppUser.id, AppUser.status)
        row = None
        if user_id:
            row = (await self.db.execute(base.where(AppUser.id == user_id))).first()
        elif external_id:
            row = (await self.db.execute(base.where(AppUser.external_id == external_id))).first()
        if row is None:
            row = (await self.db.execute(base.where(func.lower(AppUser.email) == email))).first()
        return (row.id, row.status) if row else None

    async def activate(self, user_id: str, external_id: str | None, now: datetime) -> None:
        values: dict[str, object] = {"status": "active", "updated_at": now}
        if external_id:
            values["external_id"] = external_id
        await self.db.execute(update(AppUser).where(AppUser.id == user_id).values(**values))

    async def list_admittable(self) -> list[UserRefRow]:
        rows = await self.db.execute(
            select(*_REF).where(AppUser.status.in_(("active", "invited"))).order_by(AppUser.name)
        )
        return [UserRefRow(*r) for r in rows]

    async def set_name(self, user_id: str, name: str, now: datetime) -> UserRefRow:
        row = (
            await self.db.execute(
                update(AppUser)
                .where(AppUser.id == user_id)
                .values(name=name, name_override=True, updated_at=now)
                .returning(*_REF)
            )
        ).one()
        return UserRefRow(*row)

    async def set_photo(
        self, user_id: str, photo: bytes, photo_type: str, source: str, now: datetime
    ) -> UserRefRow:
        row = (
            await self.db.execute(
                update(AppUser)
                .where(AppUser.id == user_id)
                .values(
                    photo=photo,
                    photo_type=photo_type,
                    photo_source=source,
                    photo_updated_at=now,
                    updated_at=now,
                )
                .returning(*_REF)
            )
        ).one()
        return UserRefRow(*row)

    async def clear_photo(self, user_id: str, now: datetime) -> None:
        await self.db.execute(
            update(AppUser)
            .where(AppUser.id == user_id)
            .values(
                photo=None,
                photo_type=None,
                photo_source=None,
                photo_updated_at=None,
                updated_at=now,
            )
        )

    async def active_photo(self, user_id: str) -> PhotoRow | None:
        row = (
            await self.db.execute(
                select(AppUser.photo, AppUser.photo_type, AppUser.photo_updated_at).where(
                    AppUser.id == user_id, AppUser.status == "active"
                )
            )
        ).first()
        if not row or row.photo is None or row.photo_type is None:
            return None
        return PhotoRow(bytes(row.photo), row.photo_type, row.photo_updated_at)

    async def photo_updated_at(self, user_id: str) -> datetime | None:
        return (
            await self.db.execute(select(AppUser.photo_updated_at).where(AppUser.id == user_id))
        ).scalar_one_or_none()

    async def sync_flags(self, user_id: str) -> tuple[bool, str | None]:
        """(name_override, photo_source) for the Graph profile sync."""
        row = (
            await self.db.execute(
                select(AppUser.name_override, AppUser.photo_source).where(AppUser.id == user_id)
            )
        ).one()
        return bool(row.name_override), row.photo_source

    async def set_synced_name(self, user_id: str, name: str, now: datetime) -> None:
        await self.db.execute(
            update(AppUser).where(AppUser.id == user_id).values(name=name, updated_at=now)
        )

    async def find_role_by_email(self, email: str) -> tuple[str, str] | None:
        """(id, role) by lower-cased email."""
        row = (
            await self.db.execute(
                select(AppUser.id, AppUser.role).where(func.lower(AppUser.email) == email)
            )
        ).first()
        return (row.id, row.role) if row else None

    async def set_role(self, user_id: str, role: str, now: datetime) -> None:
        await self.db.execute(
            update(AppUser).where(AppUser.id == user_id).values(role=role, updated_at=now)
        )

    async def insert(self, *, user_id: str, email: str, name: str, role: str) -> None:
        self.db.add(AppUser(id=user_id, email=email, name=name, role=role, external_id=None))
        await self.db.flush()

    # ---- user administration (D-083, FR-004)
    async def list_all(self, *, active_only: bool) -> list[UserRow]:
        q = select(*_ROW).order_by(AppUser.name.asc())
        if active_only:
            q = q.where(AppUser.status == "active")
        return [UserRow(*r) for r in await self.db.execute(q)]

    async def get(self, user_id: str) -> UserRow | None:
        row = (await self.db.execute(select(*_ROW).where(AppUser.id == user_id))).first()
        return UserRow(*row) if row else None

    async def refs(self, user_ids: list[str]) -> dict[str, UserRefRow]:
        if not user_ids:
            return {}
        rows = await self.db.execute(select(*_REF).where(AppUser.id.in_(user_ids)))
        return {r.id: UserRefRow(*r) for r in rows}

    async def name_ref(self, user_id: str | None) -> dict[str, str] | None:
        """{id, name} for event values, or None."""
        if user_id is None:
            return None
        row = (
            await self.db.execute(select(AppUser.id, AppUser.name).where(AppUser.id == user_id))
        ).first()
        return {"id": row.id, "name": row.name} if row else None

    async def email_taken(self, email: str) -> bool:
        q = select(AppUser.id).where(func.lower(AppUser.email) == email)
        return (await self.db.execute(q)).first() is not None

    async def insert_invited(
        self,
        *,
        user_id: str,
        email: str,
        name: str,
        external_id: str | None,
        invited_by: str,
        now: datetime,
    ) -> UserRow:
        row = (
            await self.db.execute(
                insert(AppUser)
                .values(
                    id=user_id,
                    email=email,
                    name=name,
                    status="invited",
                    external_id=external_id,
                    invited_at=now,
                    invited_by=invited_by,
                )
                .returning(*_ROW)
            )
        ).one()
        return UserRow(*row)

    async def update(self, user_id: str, values: dict[str, object], now: datetime) -> UserRow:
        row = (
            await self.db.execute(
                update(AppUser)
                .where(AppUser.id == user_id)
                .values(**values, updated_at=now)
                .returning(*_ROW)
            )
        ).one()
        return UserRow(*row)

    async def email_of(self, user_id: str) -> str | None:
        return (
            await self.db.execute(select(AppUser.email).where(AppUser.id == user_id))
        ).scalar_one_or_none()

    # ---- TT Suite link (SUITE-CONTRACT §3, migration 0021)
    async def find_link(self, *, suite_user_id: str | None, email: str) -> SuiteLinkRow | None:
        """By `suite_user_id`, falling back to the (case-insensitive) email."""
        row = None
        if suite_user_id:
            q = select(*_LINK).where(AppUser.suite_user_id == suite_user_id)
            row = (await self.db.execute(q)).first()
        if row is None:
            q = select(*_LINK).where(func.lower(AppUser.email) == email.strip().lower())
            row = (await self.db.execute(q)).first()
        return SuiteLinkRow(*row) if row else None

    async def find_by_suite_id(self, suite_user_id: str) -> SuiteLinkRow | None:
        q = select(*_LINK).where(AppUser.suite_user_id == suite_user_id)
        row = (await self.db.execute(q)).first()
        return SuiteLinkRow(*row) if row else None

    async def unlinked_ids(self) -> list[str]:
        """Active or invited people not yet linked to a suite person (the boot backfill)."""
        q = (
            select(AppUser.id)
            .where(AppUser.suite_user_id.is_(None), AppUser.status.in_(("active", "invited")))
            .order_by(AppUser.id)
        )
        return [r[0] for r in await self.db.execute(q)]

    async def link_of(self, user_id: str) -> SuiteLinkRow | None:
        row = (await self.db.execute(select(*_LINK).where(AppUser.id == user_id))).first()
        return SuiteLinkRow(*row) if row else None

    async def suite_user_id_of(self, user_id: str) -> str | None:
        q = select(AppUser.suite_user_id).where(AppUser.id == user_id)
        return (await self.db.execute(q)).scalar_one_or_none()

    async def set_suite_user_id(self, user_id: str, suite_user_id: str) -> None:
        """The column is unique: a stale link on another row is released first."""
        await self.db.execute(
            update(AppUser)
            .where(AppUser.suite_user_id == suite_user_id, AppUser.id != user_id)
            .values(suite_user_id=None)
        )
        await self.db.execute(
            update(AppUser).where(AppUser.id == user_id).values(suite_user_id=suite_user_id)
        )

    async def external_id_taken(self, external_id: str, user_id: str | None) -> bool:
        q = select(AppUser.id).where(AppUser.external_id == external_id)
        if user_id:
            q = q.where(AppUser.id != user_id)
        return (await self.db.execute(q)).first() is not None

    async def insert_linked(
        self,
        *,
        user_id: str,
        email: str,
        name: str,
        role: str,
        status: str,
        external_id: str | None,
        suite_user_id: str | None,
        invited_by: str | None,
        now: datetime,
    ) -> SuiteLinkRow | None:
        """A person created from the suite (provisioning or self-heal). None when a concurrent
        request created the same email first (the first pages fire several calls at once)."""
        row = (
            await self.db.execute(
                pg_insert(AppUser)
                .values(
                    id=user_id,
                    email=email,
                    name=name,
                    role=role,
                    status=status,
                    external_id=external_id,
                    suite_user_id=suite_user_id,
                    invited_at=now if status == "invited" else None,
                    invited_by=invited_by,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_nothing()
                .returning(*_LINK)
            )
        ).first()
        return SuiteLinkRow(*row) if row else None
