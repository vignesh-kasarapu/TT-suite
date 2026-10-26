"""Mirrors backend/src/services/notificationAdmin.service.js (LMS-071)."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import notification_template_dao
from app.services import audit_service

# Every template_key referenced directly (as a literal or a fixed set of
# literals) by business logic — deleting one of these leaves the referencing
# code with nothing to look up, and notification_service.notify() throws
# loudly for a missing key (as opposed to a disabled one, which it silently
# no-ops for). Disabling one of these is still fully supported; only hard
# deletion is blocked here.
PROTECTED_TEMPLATE_KEYS = {
    "BALANCE_ADJUSTED", "CARRY_FORWARD_APPLIED", "SLA_REMINDER", "ESCALATION_NOTICE_TO_PRIOR_APPROVER",
    "NEW_REQUEST_AWAITING_DECISION", "LOSS_OF_PAY_APPLIED", "COMP_OFF_CREDITED", "DELEGATE_ASSIGNED_TO_YOU",
    "EMPLOYEE_ONBOARDING_INVITE", "MANAGER_REASSIGNED", "LEAVE_ENCASHMENT_POSTED", "REQUEST_AWAITING_DECISION",
    "EXTENDED_SICK_LEAVE_ALERT", "REQUEST_SUBMITTED_CONFIRMATION", "LONG_LEAVE_SUPERVISOR_NOTICE",
    "REQUEST_APPROVED", "REQUEST_REJECTED", "CANCELLATION_REQUEST_AWAITING_DECISION", "CANCELLATION_APPROVED",
    "CANCELLATION_REJECTED", "SELF_APPROVAL_GRANTED", "WATCHED_REQUEST_SUBMITTED", "WATCHED_REQUEST_APPROVED",
    "WATCHED_REQUEST_REJECTED", "WATCHED_REQUEST_CANCELLED",
}


def list_templates(db: Session):
    return notification_template_dao.list_all(db)


def create_template(db: Session, template_key: str, subject_template: str, body_template: str, actor_id: int):
    if notification_template_dao.find_by_key(db, template_key) is not None:
        raise AppError("DUPLICATE_TEMPLATE_KEY", f'A template with key "{template_key}" already exists.')

    template = notification_template_dao.create(
        db, template_key=template_key, subject_template=subject_template, body_template=body_template,
        updated_by=actor_id,
    )
    audit_service.record(
        db, action="NOTIFICATION_TEMPLATE_CREATED", entity_type="notification_templates", entity_id=template_key,
        actor_id=actor_id, new_value={"subject_template": subject_template, "body_template": body_template},
    )
    return template


def update_template(db: Session, template_key: str, subject_template: str, body_template: str, actor_id: int):
    template = notification_template_dao.find_by_key(db, template_key)
    if template is None:
        raise AppError("NOT_FOUND", "Template not found.", status=404)

    prior = {"subject_template": template.subject_template, "body_template": template.body_template}
    template.subject_template = subject_template
    template.body_template = body_template
    template.updated_by = actor_id
    notification_template_dao.save(db, template)

    audit_service.record(
        db, action="NOTIFICATION_TEMPLATE_UPDATED", entity_type="notification_templates", entity_id=template_key,
        actor_id=actor_id, prior_value=prior, new_value={"subject_template": subject_template, "body_template": body_template},
    )
    return template


def set_template_active(db: Session, template_key: str, is_active: bool, actor_id: int):
    template = notification_template_dao.find_by_key(db, template_key)
    if template is None:
        raise AppError("NOT_FOUND", "Template not found.", status=404)

    template.is_active = is_active
    notification_template_dao.save(db, template)
    audit_service.record(
        db, action="NOTIFICATION_TEMPLATE_ENABLED" if is_active else "NOTIFICATION_TEMPLATE_DISABLED",
        entity_type="notification_templates", entity_id=template_key, actor_id=actor_id,
    )
    return template


def delete_template(db: Session, template_key: str, actor_id: int):
    template = notification_template_dao.find_by_key(db, template_key)
    if template is None:
        raise AppError("NOT_FOUND", "Template not found.", status=404)
    if template_key in PROTECTED_TEMPLATE_KEYS:
        raise AppError(
            "TEMPLATE_IN_USE",
            f'"{template_key}" is used directly by the application and cannot be deleted — disable it instead if you don\'t want it sent.',
        )

    prior_subject = template.subject_template
    notification_template_dao.delete(db, template)
    audit_service.record(
        db, action="NOTIFICATION_TEMPLATE_DELETED", entity_type="notification_templates", entity_id=template_key,
        actor_id=actor_id, prior_value={"subject_template": prior_subject},
    )
    return {"deleted": True}
