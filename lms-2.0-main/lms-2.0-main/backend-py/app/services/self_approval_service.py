"""Self-approval grants (BR/Addendum-37): who may approve their own leave, and for how long.

At most one active grant per employee, enforced here and backed by the partial unique index
`ux_self_approval_one_active_per_employee` against a concurrent second grant. Always create
through `grant()`.

How long a grant runs is three choices, not three date pickers:

* `dates` — exactly the dates HR typed;
* `leave_year` — to the last day of the leave year in force, which is what "for this year"
  means and what HR otherwise has to look up;
* `until_deactivated` — open-ended (`effective_to = NULL`). It ends when the person is
  deactivated (`employee/lifecycle.deactivate` revokes it) or when HR revokes it.
"""
from datetime import date

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import leave_year_dao, self_approval_dao
from app.services import audit_service, notification_service

DURATIONS = ("dates", "leave_year", "until_deactivated")


def resolve_period(db: Session, duration: str, effective_from, effective_to) -> tuple[date, date | None]:
    """The dates a grant actually runs for, from the choice HR made."""
    if duration not in DURATIONS:
        raise AppError("VALIDATION_ERROR", f"duration must be one of: {', '.join(DURATIONS)}.")
    start = effective_from or date.today()

    if duration == "until_deactivated":
        return start, None

    if duration == "leave_year":
        leave_year = leave_year_dao.find_current(db)
        if leave_year is None:
            raise AppError("NO_CURRENT_LEAVE_YEAR", "There is no current leave year to grant for.")
        start = max(start, leave_year.start_date)
        if start > leave_year.end_date:
            raise AppError(
                "VALIDATION_ERROR",
                f"{leave_year.year_code} ends on {leave_year.end_date}: a grant cannot start after it.",
            )
        return start, leave_year.end_date

    if effective_from is None:
        raise AppError("VALIDATION_ERROR", "A start date is required.")
    if effective_to is not None and effective_to < effective_from:
        raise AppError("VALIDATION_ERROR", "The grant cannot end before it starts.")
    return effective_from, effective_to


def describe(grant_row) -> str:
    """What a stored grant's dates mean, for the screen that lists them."""
    return "until_deactivated" if grant_row.effective_to is None else "dates"


def grant(
    db: Session, employee_id: int, granted_by: int, effective_from, effective_to,
    notes: str | None, duration: str = "dates",
):
    if self_approval_dao.find_any_active(db, employee_id) is not None:
        raise AppError("ACTIVE_GRANT_EXISTS", "This employee already has an active self-approval grant. Revoke it before issuing a new one.")

    effective_from, effective_to = resolve_period(db, duration, effective_from, effective_to)

    grant_row = self_approval_dao.create(
        db, employee_id=employee_id, granted_by=granted_by, effective_from=effective_from,
        effective_to=effective_to, is_active=True, notes=notes,
    )
    audit_service.record(
        db, action="SELF_APPROVAL_GRANTED", entity_type="self_approval_permissions",
        entity_id=grant_row.self_approval_permission_id, actor_id=granted_by,
        new_value={"employee_id": employee_id, "duration": duration,
                   "effective_from": effective_from, "effective_to": effective_to},
    )
    try:
        notification_service.notify(db, recipient_id=employee_id, template_key="SELF_APPROVAL_GRANTED", tokens={"grantedBy": granted_by})
    except Exception:  # noqa: BLE001 — Node swallows this specifically
        pass
    return grant_row


def revoke(db: Session, grant_id: int, actor_id: int):
    grant_row = self_approval_dao.find_by_id(db, grant_id)
    if grant_row is None:
        raise AppError("NOT_FOUND", "Grant not found.", status=404)
    grant_row.is_active = False
    self_approval_dao.save(db, grant_row)
    audit_service.record(db, action="SELF_APPROVAL_REVOKED", entity_type="self_approval_permissions", entity_id=grant_id, actor_id=actor_id)
    return grant_row


def list_all(db: Session):
    return self_approval_dao.list_all(db)


def revoke_active_for(db: Session, employee_id: int, actor_id: int | None, reason: str) -> int:
    """End any active grant for this person — what deactivation does to an open-ended one."""
    grant_row = self_approval_dao.find_any_active(db, employee_id)
    if grant_row is None:
        return 0
    grant_row.is_active = False
    self_approval_dao.save(db, grant_row)
    audit_service.record(
        db, action="SELF_APPROVAL_REVOKED", entity_type="self_approval_permissions",
        entity_id=grant_row.self_approval_permission_id, actor_id=actor_id,
        new_value={"employee_id": employee_id, "reason": reason},
    )
    return 1
