from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.orm import Session

from app.assignments.models import Assignment
from app.common.enums import UserRole
from app.users.models import User


class UserRepository:
    SORTABLE_COLUMNS = {
        "id": User.id,
        "name": User.name,
        "email": User.email,
        "role": User.role,
        "active": User.active,
        "created_at": User.created_at,
    }

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: int) -> User | None:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        normalized = email.strip().lower()
        stmt = select(User).where(func.lower(User.email) == normalized)
        return self.db.scalar(stmt)

    def list_users(
        self,
        page: int = 1,
        size: int = 20,
        sort: str = "id,asc",
        search: str | None = None,
        role: UserRole | None = None,
        active: bool | None = None,
    ) -> tuple[list[User], int]:
        stmt = select(User)
        count_stmt = select(func.count()).select_from(User)

        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            condition = or_(
                func.lower(User.name).like(term),
                func.lower(User.email).like(term),
            )
            stmt = stmt.where(condition)
            count_stmt = count_stmt.where(condition)

        if role is not None:
            stmt = stmt.where(User.role == role)
            count_stmt = count_stmt.where(User.role == role)

        if active is not None:
            stmt = stmt.where(User.active == active)
            count_stmt = count_stmt.where(User.active == active)

        parts = [p.strip() for p in sort.split(",") if p.strip()]
        sort_field = parts[0] if parts else "id"
        sort_dir = parts[1].lower() if len(parts) > 1 else "asc"
        column = self.SORTABLE_COLUMNS.get(sort_field, User.id)
        order_expr = desc(column) if sort_dir == "desc" else asc(column)

        stmt = stmt.order_by(order_expr, asc(User.id))
        stmt = stmt.offset((page - 1) * size).limit(size)

        total = int(self.db.scalar(count_stmt) or 0)
        items = list(self.db.scalars(stmt).all())
        return items, total

    def create(
        self,
        name: str,
        email: str,
        role: UserRole,
        active: bool = True,
    ) -> User:
        user = User(
            name=name,
            email=email.strip().lower(),
            role=role,
            active=active,
        )
        self.db.add(user)
        self.db.flush()
        self.db.refresh(user)
        return user

    def count_open_assignments(self, user_id: int) -> int:
        stmt = (
            select(func.count())
            .select_from(Assignment)
            .where(
                Assignment.user_id == user_id,
                Assignment.returned_on.is_(None),
            )
        )
        return int(self.db.scalar(stmt) or 0)

    def get_open_assignment_counts_map(self, user_ids: list[int]) -> dict[int, int]:
        if not user_ids:
            return {}
        stmt = (
            select(Assignment.user_id, func.count(Assignment.id))
            .where(
                Assignment.user_id.in_(user_ids),
                Assignment.returned_on.is_(None),
            )
            .group_by(Assignment.user_id)
        )
        rows = self.db.execute(stmt).all()
        return {int(uid): int(cnt) for uid, cnt in rows}
