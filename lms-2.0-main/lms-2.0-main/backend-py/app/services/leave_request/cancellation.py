"""Mirrors leaveRequest.service.js's withdraw, requestCancellation,
decideCancellation. requestCancellation and decideCancellation intentionally
have NO audit_service.record call, matching Node exactly (flagged there as a
gap, not silently "improved" here)."""
from math import isfinite

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import employee_dao, leave_request_approval_dao, leave_request_dao, role_dao
from app.services import approval_routing_service, audit_service, balance_service, notification_service, watcher_service


def withdraw(db: Session, request_id: int, employee_id: int):
    """LMS-051/BR-32. No ledger entry — a withdraw only ever happens before a
    ledger deduction was ever written (that only happens on APPROVED)."""
    request = leave_request_dao.find_by_id_for_update(db, request_id)
    if request is None or request.employee_id != employee_id:
        raise AppError("NOT_FOUND", "Leave request not found.", status=404)
    if request.state not in ("PENDING_MANAGER", "PENDING_HR", "REJECTED_PENDING_WITHDRAWAL"):
        raise AppError("INVALID_STATE", "Only a pending or advance-rejected request can be withdrawn.")

    request.state = "WITHDRAWN"
    db.flush()
    audit_service.record(
        db, action="LEAVE_REQUEST_WITHDRAWN", entity_type="leave_requests", entity_id=request.request_id,
        actor_id=employee_id, new_value={"state": "WITHDRAWN"},
    )
    db.commit()
    return request


def request_cancellation(db: Session, request_id: int, employee_id: int):
    """LMS-052/BR-30. Routes the cancellation decision the same way the
    original request was routed."""
    request = leave_request_dao.find_by_id_for_update(db, request_id)
    if request is None or request.employee_id != employee_id:
        raise AppError("NOT_FOUND", "Leave request not found.", status=404)
    if request.state != "APPROVED":
        raise AppError("INVALID_STATE", "Only an approved request can have cancellation requested.")

    employee = employee_dao.find_by_id(db, employee_id)
    first_stage = approval_routing_service.get_first_stage_approver(db, employee, request.start_date)
    request.state = "CANCELLATION_REQUESTED"
    request.current_approver_id = first_stage.approver_id if first_stage else None
    db.flush()

    if request.current_approver_id is not None:
        employee = employee_dao.find_by_id(db, request.employee_id)
        notification_service.notify(
            db, recipient_id=request.current_approver_id, template_key="CANCELLATION_REQUEST_AWAITING_DECISION",
            # The template names the requester; without the token the approver saw
            # "{{employeeName}} has requested cancellation".
            tokens={"employeeName": employee.full_name if employee else ""},
            related_request_id=request.request_id,
        )
    db.commit()
    return request


def decide_cancellation(db: Session, request_id: int, actor_id: int, decision: str, unelapsed_days: float | None = None):
    """LMS-053/BR-31."""
    request = leave_request_dao.find_by_id_for_update(db, request_id)
    if request is None:
        raise AppError("NOT_FOUND", "Leave request not found.", status=404)

    approval_routing_service.assert_not_self_approval(actor_id, request.employee_id)
    if request.state != "CANCELLATION_REQUESTED":
        raise AppError("INVALID_STATE", f"Request is in state {request.state}, not CANCELLATION_REQUESTED.")

    if request.current_approver_id is not None:
        if actor_id != request.current_approver_id:
            raise AppError("PERMISSION_DENIED", "This cancellation was not routed to you.", status=403)
    else:
        if not role_dao.has_role(db, actor_id, "HR_ADMIN"):
            raise AppError("PERMISSION_DENIED", "Only HR/Admin may decide this cancellation.", status=403)

    if decision == "APPROVE":
        if unelapsed_days is None or not isfinite(unelapsed_days) or not (0 <= unelapsed_days <= float(request.deducted_days or 0)):
            raise AppError(
                "INVALID_UNELAPSED_DAYS", f"unelapsed_days must be between 0 and {request.deducted_days}.",
            )
        request.state = "CANCELLED"
        db.flush()
        balance_service.write_restoration_entry(db, request, unelapsed_days, actor_id)
        leave_request_approval_dao.create(db, request_id=request.request_id, stage="CANCELLATION", actor_id=actor_id, decision="APPROVE")
        watcher_service.notify_watchers(db, request.request_id, "WATCHED_REQUEST_CANCELLED")
        notification_service.notify(db, recipient_id=request.employee_id, template_key="CANCELLATION_APPROVED", related_request_id=request.request_id)
    else:
        # Rejection returns to Approved — no ledger change.
        request.state = "APPROVED"
        db.flush()
        leave_request_approval_dao.create(db, request_id=request.request_id, stage="CANCELLATION", actor_id=actor_id, decision="REJECT")
        notification_service.notify(db, recipient_id=request.employee_id, template_key="CANCELLATION_REJECTED", related_request_id=request.request_id)

    db.commit()
    return request
