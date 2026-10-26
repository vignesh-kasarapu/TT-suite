from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.working_pattern import WorkingPattern, WorkingPatternAssignment


def list_patterns(db: Session, include_inactive: bool = False) -> list[WorkingPattern]:
    stmt = select(WorkingPattern)
    if not include_inactive:
        stmt = stmt.where(WorkingPattern.is_active.is_(True))
    return list(db.execute(stmt.order_by(WorkingPattern.pattern_name)).scalars())


def find_pattern_by_id(db: Session, working_pattern_id: int) -> WorkingPattern | None:
    return db.get(WorkingPattern, working_pattern_id)


def create_pattern(db: Session, **fields) -> WorkingPattern:
    row = WorkingPattern(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def count_assignments_for_pattern(db: Session, working_pattern_id: int) -> int:
    from sqlalchemy import func

    return db.execute(
        select(func.count())
        .select_from(WorkingPatternAssignment)
        .where(WorkingPatternAssignment.working_pattern_id == working_pattern_id)
    ).scalar_one()


def list_assignments_for_employee(db: Session, employee_id: int, exclude_assignment_id: int | None = None):
    stmt = select(WorkingPatternAssignment).where(WorkingPatternAssignment.employee_id == employee_id)
    if exclude_assignment_id is not None:
        stmt = stmt.where(WorkingPatternAssignment.assignment_id != exclude_assignment_id)
    return list(db.execute(stmt).scalars())


def list_all_assignments(db: Session) -> list[tuple[WorkingPatternAssignment, Employee, WorkingPattern]]:
    """Mirrors Node's include of Employee(id/first/last/code) + WorkingPattern(id/name/code)
    on the admin list screen — no relationship() is defined on these models, so this is a
    plain explicit join rather than an ORM-relationship eager load."""
    stmt = (
        select(WorkingPatternAssignment, Employee, WorkingPattern)
        .join(Employee, Employee.employee_id == WorkingPatternAssignment.employee_id)
        .join(WorkingPattern, WorkingPattern.working_pattern_id == WorkingPatternAssignment.working_pattern_id)
        .order_by(WorkingPatternAssignment.effective_from.desc())
    )
    return [tuple(row) for row in db.execute(stmt).all()]


def find_assignment_by_id(db: Session, assignment_id: int) -> WorkingPatternAssignment | None:
    return db.get(WorkingPatternAssignment, assignment_id)


def create_assignment(db: Session, **fields) -> WorkingPatternAssignment:
    row = WorkingPatternAssignment(**fields)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def find_active_assignment_for_date(db: Session, employee_id: int, iso_date: str | date) -> WorkingPatternAssignment | None:
    """Backs getWeekendOverrideForDate — deliberately does not filter by
    WorkingPattern.is_active: an already-assigned pattern that's later deactivated
    still applies to existing assignments (only new assignments are blocked)."""
    # PostgreSQL will not compare a DATE column with a VARCHAR parameter (MySQL coerced).
    if isinstance(iso_date, str):
        iso_date = date.fromisoformat(iso_date)
    return db.execute(
        select(WorkingPatternAssignment)
        .where(
            WorkingPatternAssignment.employee_id == employee_id,
            WorkingPatternAssignment.effective_from <= iso_date,
        )
        .where(
            (WorkingPatternAssignment.effective_to.is_(None))
            | (WorkingPatternAssignment.effective_to >= iso_date)
        )
    ).scalars().first()
