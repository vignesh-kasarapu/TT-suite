from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.employee import Employee
from app.models.notification_audit import AuditLog


def create(
    db: Session,
    *,
    actor_id: int | None,
    is_system_actor: bool,
    action: str,
    entity_type: str,
    entity_id: str,
    prior_value: str | None,
    new_value: str | None,
) -> AuditLog:
    row = AuditLog(
        actor_id=actor_id,
        is_system_actor=is_system_actor,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        prior_value=prior_value,
        new_value=new_value,
    )
    db.add(row)
    db.commit()
    return row


def find_latest_escalation(db: Session, request_id: int) -> AuditLog | None:
    """The most recent SLA escalation for one request. escalate_one_level writes
    `prior_value` as {"current_approver_id": <who it was taken from>}, which is the
    only record of where an escalated request came from."""
    stmt = (
        select(AuditLog)
        .where(
            AuditLog.action == "SLA_ESCALATED",
            AuditLog.entity_type == "leave_requests",
            AuditLog.entity_id == str(request_id),
        )
        .order_by(AuditLog.timestamp.desc(), AuditLog.audit_id.desc())
        .limit(1)
    )
    return db.execute(stmt).scalars().first()


def list_filtered(
    db: Session, *, actor_id: int | None = None, action: str | None = None, entity_type: str | None = None,
    from_ts: datetime | None = None, to_ts: datetime | None = None, limit: int = 200,
) -> list[tuple[AuditLog, Employee | None]]:
    """LMS-080: HR/Admin views and filters the audit log (R2). Left-joins
    Employee since actor_id is nullable (system actions)."""
    stmt = select(AuditLog, Employee).outerjoin(Employee, Employee.employee_id == AuditLog.actor_id)
    if actor_id is not None:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if action is not None:
        stmt = stmt.where(AuditLog.action == action)
    if entity_type is not None:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if from_ts is not None:
        stmt = stmt.where(AuditLog.timestamp >= from_ts)
    if to_ts is not None:
        stmt = stmt.where(AuditLog.timestamp <= to_ts)
    stmt = stmt.order_by(AuditLog.timestamp.desc()).limit(limit)
    return [tuple(row) for row in db.execute(stmt).all()]
