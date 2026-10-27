import logging
import math
from sqlalchemy.orm import Session

from app.common.database import transactional
from app.common.enums import UserRole
from app.common.exceptions import BadRequestException, ConflictException, NotFoundException
from app.suite import service as suite
from app.users.models import User
from app.users.repository import UserRepository
from app.users.schemas import (
    PaginatedUsersResponse,
    UserCreateRequest,
    UserResponse,
    UserUpdateRequest,
)

logger = logging.getLogger("ams.users")


class UserService:
    """TT Suite: people sign in through the portal (no passwords here). Only the global admin creates
    people and changes roles, emails and active flags: create_user/update_user are called by the
    portal's POST /internal/provision (app/suite/service.py), not by any /api route. Every change is
    mirrored to app.app_access before the commit."""

    def __init__(self, db: Session, *, source: str = "app", actor: str | None = None,
                 entra_oid: str | None = None) -> None:
        self.db = db
        self.repository = UserRepository(db)
        self.source = source
        self.actor = actor
        self.entra_oid = entra_oid

    def _mirror(self, user: User, old_email: str | None = None) -> None:
        suite.mirror(self.db, user, source=self.source, actor=self.actor, entra_oid=self.entra_oid,
                     old_email=old_email)

    def _to_user_response(self, user: User, active_assets_count: int = 0) -> UserResponse:
        return UserResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            role=user.role,
            active=user.active,
            active_assets_count=active_assets_count,
            created_at=user.created_at,
        )

    def list_users(
        self,
        page: int = 1,
        size: int = 20,
        sort: str = "id,asc",
        search: str | None = None,
        role: UserRole | None = None,
        active: bool | None = None,
    ) -> PaginatedUsersResponse:
        if page < 1 or size < 1:
            raise BadRequestException("Pagination parameters page and size must be >= 1")

        items, total = self.repository.list_users(
            page=page,
            size=size,
            sort=sort,
            search=search,
            role=role,
            active=active,
        )
        counts_map = self.repository.get_open_assignment_counts_map([u.id for u in items])
        pages = math.ceil(total / size) if total > 0 else 1
        return PaginatedUsersResponse(
            items=[
                self._to_user_response(u, active_assets_count=counts_map.get(u.id, 0))
                for u in items
            ],
            total=total,
            page=page,
            size=size,
            pages=pages,
        )

    def list_directory(
        self,
        active_only: bool = False,
    ) -> list[UserResponse]:
        items, _ = self.repository.list_users(
            page=1,
            size=200,
            sort="name,asc",
            active=True if active_only else None,
        )
        counts_map = self.repository.get_open_assignment_counts_map([u.id for u in items])
        return [
            self._to_user_response(u, active_assets_count=counts_map.get(u.id, 0))
            for u in items
        ]

    @transactional
    def create_user(self, payload: UserCreateRequest) -> UserResponse:
        normalized_email = payload.email.strip().lower()
        existing = self.repository.get_by_email(normalized_email)
        if existing is not None:
            raise ConflictException(f"User with email '{normalized_email}' already exists")

        user = self.repository.create(
            name=payload.name,
            email=normalized_email,
            role=payload.role,
            active=payload.active,
        )
        self._mirror(user)
        logger.info(
            "Created user id=%s email=%s role=%s",
            user.id,
            user.email,
            user.role.value,
        )
        return self._to_user_response(user, active_assets_count=0)

    @transactional
    def update_user(self, user_id: int, payload: UserUpdateRequest) -> UserResponse:
        user: User | None = self.repository.get_by_id(user_id)
        if user is None:
            raise NotFoundException(f"User with id {user_id} not found")

        old_email = user.email
        if payload.email is not None:
            normalized_email = payload.email.strip().lower()
            if normalized_email != user.email.lower():
                existing = self.repository.get_by_email(normalized_email)
                if existing is not None and existing.id != user.id:
                    raise ConflictException(
                        f"User with email '{normalized_email}' already exists"
                    )
                user.email = normalized_email

        open_assignments = self.repository.count_open_assignments(user.id)
        if payload.active is False and open_assignments > 0:
            raise ConflictException(
                f"Cannot deactivate user '{user.email}' because they currently hold {open_assignments} active asset assignment(s)"
            )

        if payload.name is not None:
            user.name = payload.name

        if payload.role is not None:
            user.role = payload.role

        if payload.active is not None:
            user.active = payload.active

        self._mirror(user, old_email=old_email)
        self.db.flush()
        self.db.refresh(user)
        logger.info(
            "Updated user id=%s email=%s role=%s active=%s",
            user.id,
            user.email,
            user.role.value,
            user.active,
        )
        return self._to_user_response(user, active_assets_count=open_assignments)
