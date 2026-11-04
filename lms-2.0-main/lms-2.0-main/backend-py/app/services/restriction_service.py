"""Temporary balance restrictions: days held back for a period, then available again.

A restriction is **not leave**. It never appears as usage, it never reduces the entitlement,
and it is never a ledger entry — it lives in its own table so a report can always tell "HR
held 4 days back in March" apart from "the employee took 4 days in March".

Expiry needs no job. `entitlement_service.restricted_days` counts a restriction only between
its own start and end dates, so the days come back the moment the end date passes, even if
the release sweep is late, failed or switched off. The sweep only writes down what already
happened (`state = RELEASED`), which is why running it twice releases nothing twice.
"""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, entitlement_dao, leave_type_dao, leave_year_dao
from app.services import audit_service, entitlement_service, notification_service


def _target_or_error(db: Session, leave_type_id: int | None, pool_id: int | None):
    if (leave_type_id is None) == (pool_id is None):
        raise AppError("VALIDATION_ERROR", "Choose either a leave type or a shared pool, not both.")
    if pool_id is not None:
        pool = entitlement_dao.find_pool(db, pool_id)
        if pool is None:
            raise AppError("NOT_FOUND", "Shared pool not found.", status=404)
        return entitlement_service.target_for_pool(db, pool)
    leave_type = leave_type_dao.find_by_id(db, leave_type_id)
    if leave_type is None:
        raise AppError("NOT_FOUND", "Leave type not found.", status=404)
    # A pooled type is restricted at its pool, so the same days are never held back twice.
    return entitlement_service.target_for_leave_type(db, leave_type)


def create_restriction(
    db: Session, *, employee_id: int, leave_type_id: int | None = None, pool_id: int | None = None,
    days: float, start_date: date, end_date: date, reason: str, actor_id: int,
) -> dict:
    """Hold `days` back from one employee's available balance between two dates."""
    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    if not (reason or "").strip():
        raise AppError("REASON_REQUIRED", "A reason is required for a temporary restriction.")
    if end_date < start_date:
        raise AppError("VALIDATION_ERROR", "The restriction's end date cannot be before its start date.")
    if float(days) <= 0:
        raise AppError("VALIDATION_ERROR", "Restricted days must be more than zero.")

    target = _target_or_error(db, leave_type_id, pool_id)
    leave_year = leave_year_dao.find_current(db)
    balance = entitlement_service.summary(db, employee_id, target, leave_year)

    # Never hold back more than is there: the employee would be left with a negative
    # available balance for a reason that is not leave.
    if float(days) > balance["available"]:
        raise AppError(
            "RESTRICTION_EXCEEDS_BALANCE",
            f"{employee.full_name} has {balance['available']:g} day(s) of {target.name} available; "
            f"{float(days):g} cannot be restricted.",
        )

    row = entitlement_dao.create_restriction(
        db, employee_id=employee_id, leave_type_id=target.leave_type_id, pool_id=target.pool_id,
        leave_year_id=leave_year.leave_year_id, days=float(days), start_date=start_date, end_date=end_date,
        reason=reason.strip(), state="ACTIVE", created_by=actor_id,
    )
    db.flush()
    audit_service.record(
        db, action="BALANCE_RESTRICTION_CREATED", entity_type="leave_balance_restrictions",
        entity_id=row.restriction_id, actor_id=actor_id,
        new_value={"employee_id": employee_id, "target": target.name, "days": float(days),
                   "start_date": str(start_date), "end_date": str(end_date), "reason": reason},
    )
    _notify(db, employee_id, "BALANCE_RESTRICTION_CREATED",
            {"days": float(days), "leaveType": target.name, "startDate": str(start_date),
             "endDate": str(end_date), "reason": reason})
    db.commit()
    return to_dict(db, row)


def cancel_restriction(db: Session, restriction_id: int, reason: str, actor_id: int) -> dict:
    """HR calls the restriction off early. The days are available again from this moment."""
    row = entitlement_dao.find_restriction(db, restriction_id)
    if row is None:
        raise AppError("NOT_FOUND", "Restriction not found.", status=404)
    if row.state == "CANCELLED":
        raise AppError("ALREADY_CANCELLED", "This restriction has already been cancelled.", status=409)
    if not (reason or "").strip():
        raise AppError("REASON_REQUIRED", "A reason is required to cancel a restriction.")

    row.state = "CANCELLED"
    row.cancelled_at = datetime.now(timezone.utc)
    row.cancelled_by = actor_id
    row.cancellation_reason = reason.strip()
    db.flush()
    audit_service.record(
        db, action="BALANCE_RESTRICTION_CANCELLED", entity_type="leave_balance_restrictions",
        entity_id=row.restriction_id, actor_id=actor_id, new_value={"reason": reason},
    )
    _notify(db, row.employee_id, "BALANCE_RESTRICTION_RELEASED",
            {"days": float(row.days), "leaveType": _target_name(db, row), "reason": reason})
    db.commit()
    return to_dict(db, row)


def release_expired(db: Session, as_of: date | None = None) -> int:
    """Mark every restriction whose window has passed as released. Bookkeeping only — the
    balance stopped counting them on their end date. Safe to run as often as you like."""
    as_of = as_of or date.today()
    released = 0
    for row in entitlement_dao.list_expired_active(db, as_of):
        row.state = "RELEASED"
        row.released_at = datetime.now(timezone.utc)
        audit_service.record(
            db, action="BALANCE_RESTRICTION_RELEASED", entity_type="leave_balance_restrictions",
            entity_id=row.restriction_id, is_system_actor=True,
            new_value={"employee_id": row.employee_id, "days": float(row.days), "end_date": str(row.end_date)},
        )
        _notify(db, row.employee_id, "BALANCE_RESTRICTION_RELEASED",
                {"days": float(row.days), "leaveType": _target_name(db, row), "reason": "The restriction period ended."})
        released += 1
    db.commit()
    return released


def list_for_employee(db: Session, employee_id: int, leave_year_id: int | None = None) -> list[dict]:
    leave_year_id = leave_year_id or leave_year_dao.find_current(db).leave_year_id
    rows = entitlement_dao.list_restrictions(db, employee_id=employee_id, leave_year_id=leave_year_id)
    return [to_dict(db, row) for row in rows]


def list_all(db: Session, *, leave_year_id: int | None = None, state: str | None = None) -> list[dict]:
    leave_year_id = leave_year_id or leave_year_dao.find_current(db).leave_year_id
    rows = entitlement_dao.list_restrictions(db, leave_year_id=leave_year_id, state=state)
    return [to_dict(db, row) for row in rows]


def _target_name(db: Session, row) -> str:
    if row.pool_id is not None:
        pool = entitlement_dao.find_pool(db, row.pool_id)
        return pool.pool_name if pool else "Shared pool"
    leave_type = leave_type_dao.find_by_id(db, row.leave_type_id)
    return leave_type.type_name if leave_type else "Leave"


def effective_state(row, as_of: date | None = None) -> str:
    """What the balance actually does with this restriction right now, whatever the stored
    state says — an expired row stops holding days back before any job touches it."""
    as_of = as_of or date.today()
    if row.state == "CANCELLED":
        return "CANCELLED"
    if row.end_date < as_of:
        return "EXPIRED"
    if row.start_date > as_of:
        return "SCHEDULED"
    return "ACTIVE"


def to_dict(db: Session, row) -> dict:
    employee = employee_dao.find_by_id(db, row.employee_id)
    return {
        "restriction_id": row.restriction_id,
        "employee_id": row.employee_id,
        "employee_name": employee.full_name if employee else None,
        "employee_code": employee.employee_code if employee else None,
        "leave_type_id": row.leave_type_id,
        "pool_id": row.pool_id,
        "target_name": _target_name(db, row),
        "leave_year_id": row.leave_year_id,
        "days": float(row.days),
        "start_date": row.start_date,
        "end_date": row.end_date,
        "reason": row.reason,
        "state": row.state,
        "effective_state": effective_state(row),
        "released_at": row.released_at,
        "cancelled_at": row.cancelled_at,
        "cancellation_reason": row.cancellation_reason,
        "created_by": row.created_by,
        "created_at": row.created_at,
    }


def _notify(db: Session, recipient_id: int, template_key: str, tokens: dict) -> None:
    """A missing template must never block an HR action."""
    try:
        notification_service.notify(db, recipient_id=recipient_id, template_key=template_key, tokens=tokens)
    except Exception:  # noqa: BLE001
        pass
