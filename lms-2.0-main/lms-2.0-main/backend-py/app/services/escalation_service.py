"""Mirrors backend/src/jobs/escalation.job.js. Two independent sweeps: the SLA
reminder/escalation sweep (continuous, state-based — no ScheduledJobRun row,
matching Node exactly: only ACCRUAL/CARRY_FORWARD/LOP_CONVERSION ever get one)
and the LOP conversion sweep (period-keyed, idempotent per-request via
LopRecord)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.dao import employee_dao, leave_request_query_dao, leave_type_dao, lop_record_dao, notification_dao, role_dao, scheduled_job_run_dao
from app.services import audit_service, config_service, notification_service


def run_sla_sweep(db: Session) -> None:
    """BR-34: reminder N days before the SLA deadline. BR-35/36: escalate one
    level up on breach, terminate at HR/Admin."""
    sla_days = config_service.get(db, "approval.sla_working_days")
    reminder_days_before = config_service.get(db, "approval.sla_reminder_days_before")

    for request in leave_request_query_dao.list_pending_with_sla(db):
        if request.sla_started_at is None:
            continue

        sla_started_at = request.sla_started_at
        if sla_started_at.tzinfo is None:
            sla_started_at = sla_started_at.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        elapsed_days = (now - sla_started_at).total_seconds() / 86400
        remaining_days = sla_days - elapsed_days

        if elapsed_days >= sla_days:
            escalate_one_level(db, request)
        elif remaining_days <= reminder_days_before:
            # A reminder already exists for this stage if one was sent since
            # the SLA clock last started (it resets on every escalation) —
            # without this, a request in the reminder band gets re-notified
            # on every sweep tick.
            existing = notification_dao.find_reminder_since(db, request.request_id, "SLA_REMINDER", sla_started_at.replace(tzinfo=None))
            if existing is None:
                notification_service.notify(
                    db, recipient_id=request.current_approver_id, template_key="SLA_REMINDER",
                    tokens={"requestId": request.request_id}, related_request_id=request.request_id,
                )
                db.commit()


def escalate_one_level(db: Session, request) -> None:
    current_approver = employee_dao.find_by_id(db, request.current_approver_id) if request.current_approver_id else None
    next_approver = (
        employee_dao.find_by_id(db, current_approver.reporting_manager_id)
        if current_approver and current_approver.reporting_manager_id
        else None
    )
    prior_approver_id = request.current_approver_id

    # BR-36: escalation terminates at HR/Admin; self-approval never results
    # from escalation.
    request.current_approver_id = next_approver.employee_id if next_approver else role_dao.find_hr_admin_queue_id(db)
    request.sla_started_at = datetime.now(timezone.utc)
    db.flush()

    audit_service.record(
        db, action="SLA_ESCALATED", entity_type="leave_requests", entity_id=request.request_id, is_system_actor=True,
        prior_value={"current_approver_id": prior_approver_id}, new_value={"current_approver_id": request.current_approver_id},
    )

    new_approver = employee_dao.find_by_id(db, request.current_approver_id) if request.current_approver_id else None
    new_approver_name = new_approver.full_name if new_approver else "HR/Admin"

    if prior_approver_id is not None:
        notification_service.notify(
            db, recipient_id=prior_approver_id, template_key="ESCALATION_NOTICE_TO_PRIOR_APPROVER",
            tokens={"requestId": request.request_id, "newApproverName": new_approver_name}, related_request_id=request.request_id,
        )
    if request.current_approver_id is not None:
        notification_service.notify(
            db, recipient_id=request.current_approver_id, template_key="NEW_REQUEST_AWAITING_DECISION",
            related_request_id=request.request_id,
        )
    # The requester was never told their request moved at all until now.
    notification_service.notify(
        db, recipient_id=request.employee_id, template_key="REQUEST_ESCALATED",
        tokens={"requestId": request.request_id, "newApproverName": new_approver_name}, related_request_id=request.request_id,
    )
    db.commit()


def run_lop_conversion_sweep(db: Session) -> None:
    """BR-18 to BR-20: convert expired advance-leave rejections to LOP.
    Idempotent per request via LopRecord — the job_run row is just an audit
    trail of each sweep, so its key includes the time, not just the date, or
    a legitimate same-day rerun would collide on (job_type, period_key)."""
    period_key = datetime.now(timezone.utc).isoformat()
    job_run = scheduled_job_run_dao.create(db, job_type="LOP_CONVERSION", period_key=period_key, status="RUNNING")

    try:
        lop_type = leave_type_dao.find_by_code(db, "LOP")
        expired = leave_request_query_dao.list_expired_advance_rejections(db, datetime.now(timezone.utc))

        for request in expired:
            if lop_record_dao.find_by_request_id(db, request.request_id) is not None:
                continue  # idempotent

            prior_type_id = request.leave_type_id
            request.prior_leave_type_id = prior_type_id
            request.leave_type_id = lop_type.leave_type_id
            request.state = "LOP_APPLIED"
            db.flush()

            lop_record_dao.create(
                db, request_id=request.request_id, employee_id=request.employee_id, prior_leave_type_id=prior_type_id,
                lop_leave_type_id=lop_type.leave_type_id, start_date=request.start_date, end_date=request.end_date,
                deducted_days=request.deducted_days, converted_at=datetime.now(timezone.utc),
                converted_by_job_run_id=job_run.job_run_id,
            )
            audit_service.record(
                db, action="LOP_CONVERSION", entity_type="leave_requests", entity_id=request.request_id, is_system_actor=True,
                prior_value={"leave_type_id": prior_type_id, "state": "REJECTED_PENDING_WITHDRAWAL"},
                new_value={"leave_type_id": lop_type.leave_type_id, "state": "LOP_APPLIED"},
            )
            notification_service.notify(
                db, recipient_id=request.employee_id, template_key="LOSS_OF_PAY_APPLIED", related_request_id=request.request_id,
            )
        job_run.status = "SUCCESS"
    except Exception as exc:
        job_run.status = "FAILED"
        job_run.error_message = str(exc)
        raise
    finally:
        job_run.finished_at = datetime.now(timezone.utc)
        db.commit()
