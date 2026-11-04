"""Year-end carry-forward (LMS-056/BR-27), per target and configurable.

What carries, how much of it and for how long are all settings, never code:

* **which** — `carries_forward` on the leave type's policy, or on the pool, so a shared pool
  carries once rather than once per member type;
* **how much** — `carry_forward_cap` on the same row (blank = no cap);
* **how long** — `carry_forward.expiry_days`, days into the new leave year after which
  unused carried days lapse (0 = they never expire).

Loss of Pay and Compensatory Off never carry: neither holds an entitlement.

Nothing runs unasked. The daily check only acts once the current leave year has actually
ended, and `preview` shows HR exactly what it would do before anybody approves it.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, ledger_dao, leave_year_dao, scheduled_job_run_dao
from app.services import audit_service, config_service, entitlement_service, notification_service

EXPIRY_CONFIG_KEY = "carry_forward.expiry_days"


def _carry_forward_targets(db: Session):
    return [t for t in entitlement_service.grantable_targets(db) if t.carries_forward]


def preview(db: Session, closing_leave_year_id: int) -> dict:
    """§7.2: employee by employee, what would carry, what would lapse and what the new year
    would open with. Writes nothing."""
    closing_year = leave_year_dao.find_by_id(db, closing_leave_year_id)
    if closing_year is None:
        raise AppError("NOT_FOUND", "Leave year not found.", status=404)
    next_year = leave_year_dao.find_next_after(db, closing_year.end_date)

    rows = []
    for target in _carry_forward_targets(db):
        for employee in employee_dao.list_active(db):
            summary = entitlement_service.summary(db, employee.employee_id, target, closing_year)
            balance = summary["ledger_balance"]
            if balance <= 0:
                continue
            cap = target.carry_forward_cap if target.carry_forward_cap is not None else balance
            carried = min(balance, cap)
            rows.append(
                {
                    "employee_id": employee.employee_id,
                    "employee_code": employee.employee_code,
                    "employee_name": employee.full_name,
                    "target_key": target.key,
                    "target_name": target.name,
                    "entitlement": summary["entitlement"],
                    "used": summary["used"],
                    "adjustments": summary["adjustments"],
                    "restricted": summary["restricted"],
                    "unused_balance": balance,
                    "cap": target.carry_forward_cap,
                    "carried": round(carried, 2),
                    "lapsing": round(balance - carried, 2),
                    "opening_next_year": round(carried, 2),
                }
            )
    return {
        "closing_leave_year": {"leave_year_id": closing_year.leave_year_id, "year_code": closing_year.year_code,
                               "start_date": closing_year.start_date, "end_date": closing_year.end_date,
                               "is_closed": closing_year.is_closed},
        "next_leave_year": (
            {"leave_year_id": next_year.leave_year_id, "year_code": next_year.year_code,
             "start_date": next_year.start_date, "end_date": next_year.end_date}
            if next_year else None
        ),
        "expiry_days": config_service.get_or_default(db, EXPIRY_CONFIG_KEY, 0),
        "rows": rows,
        "employees": len({r["employee_id"] for r in rows}),
        "total_carried": round(sum(r["carried"] for r in rows), 2),
        "total_lapsing": round(sum(r["lapsing"] for r in rows), 2),
    }


def run_year_end_carry_forward(db: Session, closing_leave_year_id: int) -> None:
    """Posts a carry-forward credit up to the configured cap and a lapse debit for the rest,
    then closes the year. Idempotent per (employee, target, closing year)."""
    period_key = f"CARRY_FORWARD:{closing_leave_year_id}:{datetime.now(timezone.utc).isoformat()}"
    job_run = scheduled_job_run_dao.create(db, job_type="CARRY_FORWARD", period_key=period_key, status="RUNNING")

    try:
        closing_year = leave_year_dao.find_by_id(db, closing_leave_year_id)
        if closing_year is None:
            raise AppError("NOT_FOUND", "Leave year not found.", status=404)

        if closing_year.is_closed:
            job_run.status = "SUCCESS"
            job_run.error_message = "No-op: leave year is already closed."
            return

        next_year = leave_year_dao.find_next_after(db, closing_year.end_date)
        if next_year is None:
            raise AppError(
                "NO_NEXT_LEAVE_YEAR", "No next leave year exists to carry forward into. Create it before running this job.",
            )

        for target in _carry_forward_targets(db):
            posting_type_id = target.leave_type_id or target.leave_type_ids[0]
            for employee in employee_dao.list_active(db):
                unique_key = f"carry_forward:{closing_leave_year_id}:{target.key}:{employee.employee_id}"
                if ledger_dao.find_by_source_reference(db, unique_key) is not None:
                    continue  # idempotent

                balance = ledger_dao.sum_for_target(
                    db, employee.employee_id, closing_leave_year_id, **target.ledger_filter()
                )
                if balance <= 0:
                    continue

                cap = target.carry_forward_cap if target.carry_forward_cap is not None else balance
                carried = min(balance, cap)
                lapsed = balance - carried

                if carried > 0:
                    ledger_dao.create_entry(
                        db, employee_id=employee.employee_id, leave_type_id=posting_type_id,
                        pool_id=target.pool_id, leave_year_id=next_year.leave_year_id,
                        entry_type="CARRY_FORWARD_CREDIT", quantity=carried, source_reference=unique_key,
                        is_system_actor=True,
                        reason=f"Carried forward from {closing_year.year_code} ({target.name}).",
                    )
                if lapsed > 0:
                    ledger_dao.create_entry(
                        db, employee_id=employee.employee_id, leave_type_id=posting_type_id,
                        pool_id=target.pool_id, leave_year_id=closing_leave_year_id,
                        entry_type="CARRY_FORWARD_LAPSE_DEBIT", quantity=-lapsed, source_reference=unique_key,
                        is_system_actor=True,
                        reason=f"Above the {target.name} carry-forward cap.",
                    )

                audit_service.record(
                    db, action="CARRY_FORWARD_APPLIED", entity_type="employees", entity_id=employee.employee_id,
                    is_system_actor=True,
                    new_value={"target": target.name, "carried": carried, "lapsed": lapsed},
                )
                try:
                    notification_service.notify(
                        db, recipient_id=employee.employee_id, template_key="CARRY_FORWARD_APPLIED",
                        tokens={"carried": carried, "lapsed": lapsed},
                    )
                except Exception:  # noqa: BLE001 — a notification failure never fails the job
                    pass

        # The new year's entitlement is granted the moment the year turns, so nobody waits
        # for anything: the same full grant onboarding posts (§3, §8).
        for employee in employee_dao.list_active(db):
            entitlement_service.grant_all_for_employee(db, employee, next_year, None)

        # BR-01/BR-28: a closed year is never modified again.
        closing_year.is_closed = True
        closing_year.is_current = False
        next_year.is_current = True
        db.flush()
        job_run.status = "SUCCESS"
    except Exception as exc:
        job_run.status = "FAILED"
        job_run.error_message = str(exc)
        raise
    finally:
        job_run.finished_at = datetime.now(timezone.utc)
        db.commit()


def lapse_expired_carry_forward(db: Session, as_of=None) -> int:
    """`carry_forward.expiry_days` days into a leave year, whatever is left of what was
    carried in lapses. 0 (the default) means carried days never expire."""
    expiry_days = int(config_service.get_or_default(db, EXPIRY_CONFIG_KEY, 0) or 0)
    if expiry_days <= 0:
        return 0

    leave_year = leave_year_dao.find_current(db)
    if leave_year is None:
        return 0
    as_of = as_of or datetime.now(timezone.utc).date()
    if as_of < leave_year.start_date + timedelta(days=expiry_days):
        return 0

    lapsed_count = 0
    for target in _carry_forward_targets(db):
        posting_type_id = target.leave_type_id or target.leave_type_ids[0]
        for employee in employee_dao.list_active(db):
            unique_key = f"carry_forward_expiry:{leave_year.leave_year_id}:{target.key}:{employee.employee_id}"
            if ledger_dao.find_by_source_reference(db, unique_key) is not None:
                continue
            carried = ledger_dao.sum_for_target(
                db, employee.employee_id, leave_year.leave_year_id,
                entry_types=("CARRY_FORWARD_CREDIT",), **target.ledger_filter()
            )
            if carried <= 0:
                continue
            balance = ledger_dao.sum_for_target(
                db, employee.employee_id, leave_year.leave_year_id, **target.ledger_filter()
            )
            # Only what is still unused can expire, and never more than was carried.
            expiring = round(min(carried, max(balance, 0)), 2)
            if expiring <= 0:
                continue
            ledger_dao.create_entry(
                db, employee_id=employee.employee_id, leave_type_id=posting_type_id, pool_id=target.pool_id,
                leave_year_id=leave_year.leave_year_id, entry_type="CARRY_FORWARD_LAPSE_DEBIT",
                quantity=-expiring, source_reference=unique_key, is_system_actor=True,
                reason=f"Carried-forward {target.name} days expired {expiry_days} day(s) into {leave_year.year_code}.",
            )
            lapsed_count += 1
    db.commit()
    return lapsed_count
