"""Mirrors leaveRequest.service.js's decide() — LMS-044/047, Manager/HR
decision on a pending request."""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import delegation_dao, employee_dao, leave_request_approval_dao, leave_request_dao, role_dao
from app.services import approval_routing_service, audit_service, config_service, notification_service, watcher_service
from app.services.leave_request import routing

VALID_DECISION_STATES = ("PENDING_MANAGER", "PENDING_HR")


def _delegated_by(db, request, actor_id: int) -> bool:
    """True when the request is routed to someone the actor currently delegates to.

    Delegation adds an approver; it does not remove the manager's own authority, so a
    nominator can still decide what is sitting with their delegate. Deliberately narrow: it
    does not cover an SLA escalation, which moves authority up the line on purpose.
    """
    from datetime import date as _date

    if request.current_approver_id is None:
        return False
    return any(
        d.delegate_id == request.current_approver_id
        for d in delegation_dao.list_active_on_date_for_nominator(db, actor_id, _date.today())
    )


def decide(db: Session, request_id: int, actor_id: int, decision: str, reason: str | None = None):
    request = leave_request_dao.find_by_id_for_update(db, request_id)
    if request is None:
        raise AppError("NOT_FOUND", "Leave request not found.", status=404)

    approval_routing_service.assert_not_self_approval(actor_id, request.employee_id)

    if request.state not in VALID_DECISION_STATES:
        raise AppError("INVALID_STATE", f"Request is in state {request.state} and cannot be decided.")
    if decision == "REJECT" and not (reason or "").strip():
        raise AppError("REASON_REQUIRED", "A reason is required to reject a request.")

    stage = "MANAGER" if request.state == "PENDING_MANAGER" else "HR"

    # A Manager may only decide a request actually routed to them (or their
    # active delegate) at the Manager stage; the HR stage is a role grant, not
    # a specific person, so any HR/Admin may decide it.
    if stage == "MANAGER":
        if actor_id != request.current_approver_id and not _delegated_by(db, request, actor_id):
            raise AppError("PERMISSION_DENIED", "This request was not routed to you.", status=403)
    else:
        if not role_dao.has_role(db, actor_id, "HR_ADMIN"):
            raise AppError("PERMISSION_DENIED", "Only HR/Admin may decide a request at this stage.", status=403)

    # Preserve the delegation context in the audit/approval row — match
    # against the delegation covering the request's leave start date (the one that routed it)
    # (the request may still be pending after the delegation is revoked).
    on_behalf_of_id = None
    if stage == "MANAGER":
        request_employee = employee_dao.find_by_id(db, request.employee_id)
        if request_employee and request_employee.reporting_manager_id:
            delegation = delegation_dao.find_match_for_audit_context(
                db, request_employee.reporting_manager_id, actor_id, request.start_date
            )
            on_behalf_of_id = delegation.nominator_id if delegation else None

    if decision == "APPROVE":
        routing.approve_stage_internal(db, request, stage=stage, actor_id=actor_id, on_behalf_of_id=on_behalf_of_id)
        # A Manager approval that moves to PENDING_HR isn't a decision yet,
        # just a stage transition.
        if request.state == "APPROVED":
            watcher_service.notify_watchers(db, request.request_id, "WATCHED_REQUEST_APPROVED")
    else:
        # BR-25: HR rejection after Manager approval is outright — no
        # return-for-rework.
        is_advance = request.is_advance_leave
        request.state = "REJECTED_PENDING_WITHDRAWAL" if is_advance else "REJECTED"
        if is_advance:
            window_days = config_service.get(db, "advance_leave.withdrawal_window_days")
            request.withdrawal_window_end = datetime.now(timezone.utc) + timedelta(days=window_days)
        request.current_approver_id = None
        db.flush()
        if is_advance:
            # The rejection mail does not say what happens next: the days become unpaid unless
            # the employee withdraws the request within the window.
            days = float(request.deducted_days or 0)
            notification_service.notify_in_app(
                db, recipient_id=request.employee_id, template_key="ADVANCE_LEAVE_WITHDRAW_WINDOW",
                related_request_id=request.request_id,
                subject=f"Withdraw within {window_days} days or it becomes loss of pay",
                body=(
                    f"Your advance leave {request.start_date:%d %b} to {request.end_date:%d %b %Y} "
                    f"({days:g} day(s)) was rejected. Withdraw it in My Requests within {window_days} day(s), "
                    f"by {request.withdrawal_window_end:%d %b %Y %H:%M} UTC. Otherwise the {days:g} day(s) "
                    "become loss of pay (unpaid)."
                ),
            )

        leave_request_approval_dao.create(
            db, request_id=request.request_id, stage=stage, actor_id=actor_id, on_behalf_of_id=on_behalf_of_id,
            decision="REJECT", reason=reason,
        )
        watcher_service.notify_watchers(db, request.request_id, "WATCHED_REQUEST_REJECTED")

    audit_service.record(
        db, action=f"LEAVE_REQUEST_{decision}", entity_type="leave_requests", entity_id=request.request_id,
        actor_id=actor_id, new_value={"state": request.state, "reason": reason},
    )
    notification_service.notify(
        db, recipient_id=request.employee_id,
        template_key="REQUEST_APPROVED" if decision == "APPROVE" else "REQUEST_REJECTED",
        tokens={"reason": reason or ""}, related_request_id=request.request_id,
    )
    db.commit()
    return request
