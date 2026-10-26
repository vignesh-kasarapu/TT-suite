"""Mirrors backend/src/services/selfApproval.service.js. Enforces "at most
one active grant per employee" here, in the service layer (BR/Addendum-37); the
PostgreSQL partial unique index ux_self_approval_one_active_per_employee backs it
up against concurrent grants. Always go through this function to create a grant."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import self_approval_dao
from app.services import audit_service, notification_service


def grant(db: Session, employee_id: int, granted_by: int, effective_from, effective_to, notes: str | None):
    if self_approval_dao.find_any_active(db, employee_id) is not None:
        raise AppError("ACTIVE_GRANT_EXISTS", "This employee already has an active self-approval grant. Revoke it before issuing a new one.")

    grant_row = self_approval_dao.create(
        db, employee_id=employee_id, granted_by=granted_by, effective_from=effective_from,
        effective_to=effective_to, is_active=True, notes=notes,
    )
    audit_service.record(
        db, action="SELF_APPROVAL_GRANTED", entity_type="self_approval_permissions",
        entity_id=grant_row.self_approval_permission_id, actor_id=granted_by,
        new_value={"employee_id": employee_id, "effective_from": effective_from, "effective_to": effective_to},
    )
    try:
        notification_service.notify(db, recipient_id=employee_id, template_key="SELF_APPROVAL_GRANTED", tokens={"grantedBy": granted_by})
    except Exception:  # noqa: BLE001 — Node swallows this specifically
        pass
    return grant_row


def revoke(db: Session, grant_id: int, actor_id: int):
    grant_row = self_approval_dao.find_by_id(db, grant_id)
    if grant_row is None:
        raise AppError("NOT_FOUND", "Grant not found.", status=404)
    grant_row.is_active = False
    self_approval_dao.save(db, grant_row)
    audit_service.record(db, action="SELF_APPROVAL_REVOKED", entity_type="self_approval_permissions", entity_id=grant_id, actor_id=actor_id)
    return grant_row


def list_all(db: Session):
    return self_approval_dao.list_all(db)
