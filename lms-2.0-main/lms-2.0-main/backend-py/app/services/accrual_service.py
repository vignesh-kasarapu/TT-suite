"""Mirrors backend/src/jobs/accrual.job.js."""
import math
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.dao import employee_dao, ledger_dao, leave_type_dao, leave_year_dao, scheduled_job_run_dao

PERIODS_PER_YEAR = {"MONTHLY": 12, "QUARTERLY": 4, "ANNUAL": 1}


def post_opening_pro_rata(db: Session, employee_id: int) -> None:
    """BR-13/14/15: pro-rata opening entitlement, rounded UP, posted
    automatically on onboarding."""
    leave_year = leave_year_dao.find_current(db)
    employee = employee_dao.find_by_id(db, employee_id)
    period_key = f"OPENING:{leave_year.year_code}:{employee_id}"

    if scheduled_job_run_dao.find_by_type_and_period(db, "ACCRUAL", period_key) is not None:
        return  # NFR-16 idempotency guard

    total_days_in_year = (leave_year.end_date - leave_year.start_date).days + 1
    days_from_join_to_year_end = (leave_year.end_date - employee.date_of_joining).days + 1
    # Clamp to 1.0: an employee who joined before the current leave year
    # started would otherwise produce a ratio > 1 and be over-credited.
    ratio = min(days_from_join_to_year_end / total_days_in_year, 1)

    for policy in leave_type_dao.list_balance_affecting_policies(db):
        raw = float(policy.annual_entitlement) * ratio  # BR-13
        rounded = math.ceil(raw)  # BR-14: rounds up, deliberate generosity
        ledger_dao.create_entry(
            db, employee_id=employee_id, leave_type_id=policy.leave_type_id, leave_year_id=leave_year.leave_year_id,
            entry_type="OPENING_PRO_RATA_CREDIT", quantity=rounded, source_reference=f"onboarding:{employee_id}",
            is_system_actor=True,
        )

    scheduled_job_run_dao.create(db, job_type="ACCRUAL", period_key=period_key, status="SUCCESS", finished_at=datetime.now(timezone.utc))
    db.commit()


def post_entitlement_revision(
    db: Session, leave_type_id: int, old_entitlement: float, new_entitlement: float, actor_id: int | None
) -> int:
    """An entitlement edit must reach balances that already exist. Posts the
    difference to every active employee for the current leave year, scaled by
    the same joining-date pro-rata ratio the opening credit used (BR-13), so
    a mid-year joiner gets a proportionate share. Returns employees adjusted."""
    delta = float(new_entitlement) - float(old_entitlement)
    if delta == 0:
        return 0
    leave_year = leave_year_dao.find_current(db)
    total_days_in_year = (leave_year.end_date - leave_year.start_date).days + 1
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    adjusted = 0
    for employee in employee_dao.list_active(db):
        days_from_join = (leave_year.end_date - employee.date_of_joining).days + 1
        ratio = max(min(days_from_join / total_days_in_year, 1), 0)
        quantity = round(delta * ratio, 1)
        if quantity == 0:
            continue
        ledger_dao.create_entry(
            db, employee_id=employee.employee_id, leave_type_id=leave_type_id, leave_year_id=leave_year.leave_year_id,
            entry_type="ENTITLEMENT_REVISION_ADJUSTMENT", quantity=quantity,
            source_reference=f"entitlement_revision:{leave_type_id}:{employee.employee_id}:{stamp}",
            actor_id=actor_id, is_system_actor=actor_id is None,
            reason=f"Annual entitlement changed from {float(old_entitlement):g} to {float(new_entitlement):g} days.",
        )
        adjusted += 1
    return adjusted


def run_periodic_accrual(db: Session, period_key: str) -> None:
    """LMS-055: periodic accrual posting, uniquely keyed on (employee, leave
    type, period) via the ledger's source_reference — never double-credits."""
    job_run = scheduled_job_run_dao.find_by_type_and_period(db, "ACCRUAL", period_key)
    if job_run is not None:
        if job_run.status == "SUCCESS":
            return  # already completed for this period
        job_run.status = "RUNNING"
        job_run.error_message = None
        scheduled_job_run_dao.save(db, job_run)
    else:
        job_run = scheduled_job_run_dao.create(db, job_type="ACCRUAL", period_key=period_key, status="RUNNING")

    try:
        leave_year = leave_year_dao.find_current(db)
        configs = leave_type_dao.list_all_accrual_configs(db)
        policies = {p.leave_type_id: p for p in leave_type_dao.list_all_policies(db)}
        employees = employee_dao.list_active(db)

        for cfg in configs:
            policy = policies.get(cfg.leave_type_id)
            if policy is None:
                continue
            periods_per_year = PERIODS_PER_YEAR.get(cfg.accrual_method)
            per_period = float(policy.annual_entitlement) / periods_per_year

            for employee in employees:
                unique_key = f"{period_key}:{cfg.leave_type_id}:{employee.employee_id}"
                if ledger_dao.find_by_source_reference(db, unique_key) is not None:
                    continue  # idempotent
                ledger_dao.create_entry(
                    db, employee_id=employee.employee_id, leave_type_id=cfg.leave_type_id,
                    leave_year_id=leave_year.leave_year_id, entry_type="PERIODIC_ACCRUAL_CREDIT",
                    quantity=per_period, source_reference=unique_key, is_system_actor=True,
                )
        job_run.status = "SUCCESS"
    except Exception as exc:
        job_run.status = "FAILED"
        job_run.error_message = str(exc)
        raise
    finally:
        job_run.finished_at = datetime.now(timezone.utc)
        db.commit()
