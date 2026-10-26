"""Mirrors backend/src/jobs/carryForward.job.js. Callable both from the daily
cron (only when the current leave year has actually ended) and from the
admin-triggered POST /api/admin/carry-forward/trigger endpoint — same
function, same idempotency guarantees either way."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, ledger_dao, leave_type_dao, leave_year_dao, scheduled_job_run_dao
from app.services import audit_service, balance_service, notification_service


def run_year_end_carry_forward(db: Session, closing_leave_year_id: int) -> None:
    """LMS-056/BR-27: for each employee x carry-forward-enabled leave type,
    posts a carry-forward credit up to the configured cap and a lapse debit
    for the excess. Idempotent per (employee, leave type, closing year)."""
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

        for policy in leave_type_dao.list_carry_forward_policies(db):
            for employee in employee_dao.list_active(db):
                unique_key = f"carry_forward:{closing_leave_year_id}:{policy.leave_type_id}:{employee.employee_id}"
                if ledger_dao.find_by_source_reference(db, unique_key) is not None:
                    continue  # idempotent

                balance = balance_service.get_ledger_balance(db, employee.employee_id, policy.leave_type_id, closing_leave_year_id)
                if balance <= 0:
                    continue

                cap = float(policy.carry_forward_cap) if policy.carry_forward_cap is not None else balance
                carried = min(balance, cap)
                lapsed = balance - carried

                if carried > 0:
                    ledger_dao.create_entry(
                        db, employee_id=employee.employee_id, leave_type_id=policy.leave_type_id,
                        leave_year_id=next_year.leave_year_id, entry_type="CARRY_FORWARD_CREDIT",
                        quantity=carried, source_reference=unique_key, is_system_actor=True,
                    )
                if lapsed > 0:
                    ledger_dao.create_entry(
                        db, employee_id=employee.employee_id, leave_type_id=policy.leave_type_id,
                        leave_year_id=closing_leave_year_id, entry_type="CARRY_FORWARD_LAPSE_DEBIT",
                        quantity=-lapsed, source_reference=unique_key, is_system_actor=True,
                    )

                audit_service.record(
                    db, action="CARRY_FORWARD_APPLIED", entity_type="employees", entity_id=employee.employee_id,
                    is_system_actor=True, new_value={"leave_type_id": policy.leave_type_id, "carried": carried, "lapsed": lapsed},
                )
                try:
                    notification_service.notify(
                        db, recipient_id=employee.employee_id, template_key="CARRY_FORWARD_APPLIED",
                        tokens={"carried": carried, "lapsed": lapsed},
                    )
                except Exception:  # noqa: BLE001 — Node swallows notify() failures here specifically
                    pass

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
