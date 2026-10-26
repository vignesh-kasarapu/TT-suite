"""Mirrors leaveRequest.service.js's routeAndFinalizeSubmission and
approveStageInternal — shared by submitRequest/submitDraft and by decide()
respectively. Kept together since they're the two halves of "what happens
when a request advances a stage."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, leave_request_approval_dao, org_structure_dao, role_dao, watcher_dao
from app.services import approval_routing_service, balance_service, config_service, notification_service, watcher_service


def approve_stage_internal(db: Session, request, stage: str, actor_id: int, on_behalf_of_id: int | None):
    if stage != "SELF":
        approval_routing_service.assert_not_self_approval(actor_id, request.employee_id)

    leave_request_approval_dao.create(
        db, request_id=request.request_id, stage=stage, actor_id=actor_id, on_behalf_of_id=on_behalf_of_id,
        decision="APPROVE",
    )

    if stage in ("SELF", "HR") or (stage == "MANAGER" and not request.is_long_leave):
        request.state = "APPROVED"
        request.current_approver_id = None
        db.flush()
        balance_service.write_deduction_entry(db, request, actor_id)  # BR-09
    elif stage == "MANAGER" and request.is_long_leave:
        # BR-23: sequential — HR does not see it until Manager approves.
        request.state = "PENDING_HR"
        db.flush()
        manager = employee_dao.find_by_id(db, actor_id)
        if manager and manager.reporting_manager_id:
            # BR-26/LMS-046: notification only — the supervisor has no
            # approval authority over this request.
            notification_service.notify(
                db, recipient_id=manager.reporting_manager_id, template_key="LONG_LEAVE_SUPERVISOR_NOTICE",
                tokens={"employeeName": _employee_name(db, request.employee_id)}, related_request_id=request.request_id,
            )
    return request


def _employee_name(db: Session, employee_id: int) -> str:
    employee = employee_dao.find_by_id(db, employee_id)
    return employee.full_name if employee else ""


def route_and_finalize_submission(db: Session, request, employee, leave_type):
    """Routes the request to its first approval stage (self-approval
    addendum, or Manager/Delegate per BR-22), applies project-lead (LMS-014)
    and standing watchers, and runs extended sick-leave alerting
    (BR-43/44/45)."""
    self_eligible = approval_routing_service.is_eligible_for_self_approval(db, employee)
    if self_eligible:
        approve_stage_internal(db, request, stage="SELF", actor_id=employee.employee_id, on_behalf_of_id=None)
    else:
        first_stage = approval_routing_service.get_first_stage_approver(db, employee, request.start_date)
        if first_stage is None:
            raise AppError("NO_APPROVER", "No reporting manager on record and no self-approval grant exists.")
        request.current_approver_id = first_stage.approver_id
        request.sla_started_at = datetime.now(timezone.utc)
        db.flush()
        notification_service.notify(
            db, recipient_id=first_stage.approver_id, template_key="REQUEST_AWAITING_DECISION",
            tokens={
                "employeeName": employee.full_name, "startDate": request.start_date.isoformat(),
                "endDate": request.end_date.isoformat(), "days": request.deducted_days,
            },
            related_request_id=request.request_id,
        )

    # LMS-014: project-lead auto-watcher.
    assignments = org_structure_dao.list_active_assignments_for_employee(
        db, employee.employee_id, request.start_date, request.end_date
    )
    for assignment in assignments:
        if watcher_dao.find_existing(db, request.request_id, assignment.project_lead_id) is None:
            watcher_dao.create(
                db, request_id=request.request_id, watcher_employee_id=assignment.project_lead_id,
                added_by_id=employee.employee_id,
            )

    # LMS-062: standing watchers.
    watcher_service.apply_standing_watchers(db, request)

    # Notification matrix Section 6.5.
    watcher_service.notify_watchers(db, request.request_id, "WATCHED_REQUEST_SUBMITTED")

    # BR-43/44/45: extended sick-leave alerting.
    if leave_type.is_sick_leave:
        sick_threshold = config_service.get(db, "sick_leave.alert_threshold_days")
        sick_aggregate = approval_routing_service.get_contiguous_aggregate_days(
            db, employee.employee_id, leave_type.leave_type_id, request.start_date, request.end_date,
            sick_only=True, leave_year_id=request.leave_year_id,
        )
        # sick_aggregate sums OTHER contiguous Sick requests only, never this
        # one's own days — must be added, not maxed.
        if (float(request.deducted_days or 0) + sick_aggregate) > sick_threshold:
            alert_supervisor = config_service.get(db, "sick_leave.alert_supervisor_enabled")
            alert_hr = config_service.get(db, "sick_leave.alert_hr_enabled")
            tokens = {"employeeName": employee.full_name, "days": request.deducted_days}

            if alert_supervisor and employee.reporting_manager_id:
                manager = employee_dao.find_by_id(db, employee.reporting_manager_id)
                if manager and manager.reporting_manager_id:
                    notification_service.notify(
                        db, recipient_id=manager.reporting_manager_id, template_key="EXTENDED_SICK_LEAVE_ALERT",
                        tokens=tokens, related_request_id=request.request_id,
                    )
            if alert_hr:
                for hr_id in role_dao.list_employee_ids_with_role(db, "HR_ADMIN"):
                    notification_service.notify(
                        db, recipient_id=hr_id, template_key="EXTENDED_SICK_LEAVE_ALERT", tokens=tokens,
                        related_request_id=request.request_id,
                    )
