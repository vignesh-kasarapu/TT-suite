"""Compensatory off (LMS-083): time off earned against approved extra work.

A request now goes through two stages, the way a leave request does:

    PENDING_MANAGER -> PENDING_HR -> APPROVED        (REJECTED at either stage)

Nothing reaches the ledger until the HR stage approves it; a rejection at either stage
credits nothing. The conversion is fixed at **8 approved hours = 1 comp-off day**, applied
proportionally — 2 hours is 0.25 of a day, never rounded up to one.

The credit belongs to the leave year the **work** falls in, not the one that happens to be
current when HR gets round to approving: work on 31 March approved on 2 April is still March's.
"""
import math
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import comp_off_dao, employee_dao, ledger_dao, leave_type_dao, leave_year_dao
from app.services import approval_routing_service, audit_service, notification_service
from app.services.employee.hierarchy import is_in_manager_hierarchy

#: BR: a full working day is 8 hours. Partial hours convert proportionally.
HOURS_PER_COMP_OFF_DAY = 8.0

PENDING_MANAGER, PENDING_HR, APPROVED, REJECTED = "PENDING_MANAGER", "PENDING_HR", "APPROVED", "REJECTED"
OPEN_STATUSES = (PENDING_MANAGER, PENDING_HR)


def days_for_hours(hours: float) -> float:
    """8 hours = 1 day, proportional, to the 2 decimals the ledger stores."""
    return round(float(hours) / HOURS_PER_COMP_OFF_DAY, 2)


def leave_year_for_work_date(db: Session, work_date: date):
    """The leave year containing the work date. Falls back to the current year only when the
    work date lies outside every year on record (e.g. before the first one was created)."""
    for year in leave_year_dao.list_all(db):
        if year.start_date <= work_date <= year.end_date:
            return year
    return leave_year_dao.find_current(db)


def _comp_off_type(db: Session):
    comp_off_type = leave_type_dao.find_by_code(db, "COMP_OFF")
    if comp_off_type is None:
        raise AppError(
            "COMP_OFF_TYPE_MISSING",
            "Compensatory off is not available yet.",
            status=409,
        )
    return comp_off_type


def submit_request(db: Session, employee_id: int, work_date: date, hours_worked: float, requested_by: int, notes: str | None):
    """Stage 1 — the employee (or HR on their behalf) claims extra hours worked."""
    hours = float(hours_worked)
    if not math.isfinite(hours) or hours <= 0:
        raise AppError("INVALID_HOURS", "hoursWorked must be a positive number.")
    if work_date is None:
        raise AppError("INVALID_WORK_DATE", "workDate must be a valid date.")
    if work_date > date.today():
        raise AppError("WORK_DATE_IN_FUTURE", "Compensatory off can only be claimed for work already done.")

    employee = employee_dao.find_by_id(db, employee_id)
    if employee is None:
        raise AppError("NOT_FOUND", "Employee not found.", status=404)
    if not employee.is_active:
        raise AppError("EMPLOYEE_INACTIVE", "Compensatory off cannot be credited to a deactivated employee.")

    _comp_off_type(db)  # fail early if the type is missing, before anything is written

    # One claim per employee per work date, unless the earlier one was rejected.
    existing = comp_off_dao.find_existing(db, employee_id, work_date, exclude_statuses=(REJECTED,))
    if existing is not None:
        raise AppError("DUPLICATE_COMP_OFF", "A compensatory-off claim already exists for this employee on this work date.")

    leave_year = leave_year_for_work_date(db, work_date)
    # Where the claim starts. A claim must never come to rest somewhere nobody can act on
    # it, which is what happened to anyone without a reporting manager: it sat at
    # PENDING_MANAGER for ever because the manager stage had no owner.
    status, manager_id, manager_decided_at, manager_comments = PENDING_MANAGER, None, None, None
    if employee.reporting_manager_id is None:
        # No higher authority on record (BR-22's first stage cannot be filled): HR decides.
        status = PENDING_HR
        manager_comments = "No reporting manager on record — the manager stage does not apply."
    elif requested_by != employee_id and is_in_manager_hierarchy(db, requested_by, employee_id):
        # Raised BY the manager for their own report: the manager stage is their own act,
        # so recording it here and moving on beats asking them to approve themselves.
        status = PENDING_HR
        manager_id = requested_by
        manager_decided_at = datetime.now(timezone.utc)
        manager_comments = "Raised by the manager on the employee's behalf."

    row = comp_off_dao.create(
        db, employee_id=employee_id, work_date=work_date, hours_worked=hours,
        hours_or_days=days_for_hours(hours), leave_year_id=leave_year.leave_year_id if leave_year else None,
        status=status, requested_by=requested_by, notes=notes,
        manager_id=manager_id, manager_decided_at=manager_decided_at, manager_comments=manager_comments,
    )
    audit_service.record(
        db, action="COMP_OFF_REQUESTED", entity_type="compensatory_off_credits", entity_id=row.comp_off_id,
        actor_id=requested_by,
        new_value={"employee_id": employee_id, "work_date": str(work_date), "hours_worked": hours,
                   "days": float(row.hours_or_days), "status": PENDING_MANAGER},
    )
    if status == PENDING_MANAGER and employee.reporting_manager_id:
        _notify(db, employee.reporting_manager_id, "COMP_OFF_REQUESTED",
                "Compensatory off awaiting your decision",
                f"{employee.full_name} claims {hours:g} hour(s) of extra work on {work_date} "
                f"({float(row.hours_or_days):g} comp-off day(s)).")

    # Top of the reporting tree with a self-approval grant (R1 Addendum table 37): the same
    # rule leave requests use, so a claim cannot stall with nobody above the claimant.
    if status == PENDING_HR and requested_by == employee_id             and approval_routing_service.is_eligible_for_self_approval(db, employee):
        _approve_and_credit(db, row, actor_id=employee_id, comments="Self-approved: no higher authority on record.")
    db.commit()
    return row


def decide(db: Session, comp_off_id: int, approve: bool, actor_id: int, comments: str | None, *, as_hr: bool):
    """Stages 2 and 3. The manager moves PENDING_MANAGER on; HR moves PENDING_HR on, and
    only that final approval writes the ledger credit."""
    row = comp_off_dao.find_by_id_for_update(db, comp_off_id)
    if row is None:
        raise AppError("NOT_FOUND", "Compensatory-off request not found.", status=404)
    if row.employee_id == actor_id:
        raise AppError("SELF_APPROVAL_NOT_ALLOWED", "You cannot decide your own compensatory-off request.")

    expected = PENDING_HR if as_hr else PENDING_MANAGER
    if row.status != expected:
        raise AppError(
            "WRONG_STAGE",
            f"This request is {row.status.replace('_', ' ').lower()}; it cannot be decided at the "
            f"{'HR' if as_hr else 'manager'} stage.",
        )

    now = datetime.now(timezone.utc)
    prior_status = row.status
    if as_hr:
        row.hr_id, row.hr_decided_at, row.hr_comments = actor_id, now, comments
    else:
        row.manager_id, row.manager_decided_at, row.manager_comments = actor_id, now, comments

    if not approve:
        row.status = REJECTED
        db.flush()
        _record(db, "COMP_OFF_REJECTED", row, actor_id, prior_status, {"status": REJECTED, "comments": comments})
        _notify(db, row.employee_id, "COMP_OFF_REJECTED", "Your compensatory-off request was rejected",
                f"Your claim for {float(row.hours_worked or 0):g} hour(s) on {row.work_date} was rejected."
                + (f" Reason: {comments}" if comments else ""))
        db.commit()
        return row

    if not as_hr:
        row.status = PENDING_HR
        db.flush()
        _record(db, "COMP_OFF_MANAGER_APPROVED", row, actor_id, prior_status, {"status": PENDING_HR, "comments": comments})
        _notify(db, row.employee_id, "COMP_OFF_MANAGER_APPROVED", "Your manager approved your compensatory off",
                f"Your claim for {row.work_date} is now with HR for final approval.")
        db.commit()
        return row

    # Final HR approval: the one and only ledger credit.
    _approve_and_credit(db, row, actor_id, comments)
    db.commit()
    return row


def _approve_and_credit(db: Session, row, actor_id: int, comments: str | None):
    """The final step, shared by the HR decision and by a self-approval grant: credit the
    ledger once, against the leave year the WORK falls in."""
    if row.ledger_entry_id is not None:
        raise AppError("ALREADY_CREDITED", "This request has already been credited.")

    prior_status = row.status
    comp_off_type = _comp_off_type(db)
    leave_year = leave_year_dao.find_by_id(db, row.leave_year_id) if row.leave_year_id else None
    leave_year = leave_year or leave_year_for_work_date(db, row.work_date)
    if leave_year is None:
        raise AppError("NO_LEAVE_YEAR", "No leave year covers this work date; create it before approving.")
    if leave_year.is_closed:
        raise AppError(
            "CLOSED_YEAR",
            f"The leave year containing {row.work_date} ({leave_year.year_code}) is closed and can no longer be credited.",
        )

    days = days_for_hours(row.hours_worked if row.hours_worked is not None else row.hours_or_days * HOURS_PER_COMP_OFF_DAY)
    ledger_entry = ledger_dao.create_entry(
        db, employee_id=row.employee_id, leave_type_id=comp_off_type.leave_type_id,
        leave_year_id=leave_year.leave_year_id, entry_type="COMP_OFF_CREDIT", quantity=days,
        # Employee-scoped, unlike the old "comp_off:<date>" which was identical for everyone
        # credited on the same day.
        source_reference=f"comp_off:{row.comp_off_id}",
        actor_id=actor_id, reason=row.notes or f"Compensatory off for work on {row.work_date}",
    )
    row.status = APPROVED
    row.hours_or_days = days
    row.leave_year_id = leave_year.leave_year_id
    row.approved_by = actor_id
    row.hr_id = row.hr_id or actor_id
    row.hr_decided_at = row.hr_decided_at or datetime.now(timezone.utc)
    row.hr_comments = row.hr_comments or comments
    row.ledger_entry_id = ledger_entry.entry_id
    db.flush()

    _record(db, "COMP_OFF_CREDITED", row, actor_id, prior_status, {
        "status": APPROVED, "days": days, "leave_year_id": leave_year.leave_year_id,
        "ledger_entry_id": ledger_entry.entry_id, "comments": comments,
    })
    _notify(db, row.employee_id, "COMP_OFF_CREDITED", "Compensatory off credited",
            f"{days:g} day(s) of compensatory off have been credited for your work on {row.work_date}.")
    return row


def _record(db: Session, action: str, row, actor_id: int, prior_status: str, new_value: dict) -> None:
    audit_service.record(
        db, action=action, entity_type="compensatory_off_credits", entity_id=row.comp_off_id,
        actor_id=actor_id, prior_value={"status": prior_status},
        new_value={"employee_id": row.employee_id, "work_date": str(row.work_date), **new_value},
    )


def _notify(db: Session, recipient_id: int, template_key: str, subject: str, body: str) -> None:
    try:
        notification_service.notify(db, recipient_id=recipient_id, template_key=template_key, tokens={})
    except Exception:  # noqa: BLE001 — a notification never fails a decision
        try:
            notification_service.notify_in_app(db, recipient_id=recipient_id, template_key=template_key, subject=subject, body=body)
        except Exception:  # noqa: BLE001
            pass


def list_for_employee(db: Session, employee_id: int):
    return comp_off_dao.list_for_employee(db, employee_id)


def list_requests(
    db: Session, *, status: str | None = None, statuses: tuple[str, ...] | None = None,
    employee_ids: list[int] | None = None,
):
    return comp_off_dao.list_requests(db, status=status, statuses=statuses, employee_ids=employee_ids)
