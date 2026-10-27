from datetime import date
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.assignments.models import Assignment
from app.common.enums import ReturnReason


class AssignmentRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, assignment_id: int) -> Assignment | None:
        return self.db.get(Assignment, assignment_id)

    def get_open_assignee_names(self, asset_ids: list[int]) -> dict[int, str]:
        if not asset_ids:
            return {}
        from app.users.models import User

        stmt = (
            select(Assignment.asset_id, User.name)
            .join(User, Assignment.user_id == User.id)
            .where(
                Assignment.asset_id.in_(asset_ids),
                Assignment.returned_on.is_(None),
            )
        )
        return {int(row[0]): str(row[1]) for row in self.db.execute(stmt).all()}

    def get_open_assignment_for_asset(self, asset_id: int) -> Assignment | None:
        stmt = select(Assignment).where(
            Assignment.asset_id == asset_id,
            Assignment.returned_on.is_(None),
        )
        return self.db.scalar(stmt)

    def get_employee_name_for_maintenance(
        self,
        asset_id: int,
        opened_on: date | None = None,
    ) -> str | None:
        """Resolve the employee who held the asset when maintenance was opened."""
        closed_stmt = (
            select(Assignment)
            .where(
                Assignment.asset_id == asset_id,
                Assignment.returned_on.is_not(None),
            )
            .order_by(desc(Assignment.returned_on), desc(Assignment.id))
        )
        closed = list(self.db.scalars(closed_stmt).all())
        if not closed:
            return None

        if opened_on is not None:
            for assignment in closed:
                if assignment.returned_on == opened_on:
                    return assignment.user_name

        # Prefer returns that sent the asset into maintenance
        for assignment in closed:
            if assignment.return_reason in (
                ReturnReason.IN_MAINTENANCE,
                ReturnReason.REPLACEMENT,
            ):
                return assignment.user_name

        return closed[0].user_name

    def list_by_asset_id(self, asset_id: int) -> list[Assignment]:
        stmt = (
            select(Assignment)
            .where(Assignment.asset_id == asset_id)
            .order_by(desc(Assignment.assigned_on), desc(Assignment.id))
        )
        return list(self.db.scalars(stmt).all())

    def list_open_by_user_id(self, user_id: int) -> list[Assignment]:
        stmt = (
            select(Assignment)
            .where(
                Assignment.user_id == user_id,
                Assignment.returned_on.is_(None),
            )
            .order_by(desc(Assignment.assigned_on), desc(Assignment.id))
        )
        return list(self.db.scalars(stmt).all())

    def create(
        self,
        asset_id: int,
        user_id: int,
        assigned_on: date,
    ) -> Assignment:
        assignment = Assignment(
            asset_id=asset_id,
            user_id=user_id,
            assigned_on=assigned_on,
            returned_on=None,
            return_reason=None,
        )
        self.db.add(assignment)
        self.db.flush()
        self.db.refresh(assignment)
        return assignment

    def close_assignment(
        self,
        assignment: Assignment,
        returned_on: date,
        return_reason: ReturnReason | None = ReturnReason.OTHER,
    ) -> Assignment:
        assignment.returned_on = returned_on
        assignment.return_reason = return_reason
        self.db.flush()
        self.db.refresh(assignment)
        return assignment
