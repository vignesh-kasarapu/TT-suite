from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import AuditLog


def log(
    db: Session,
    actor_id: int | None,
    action: str,
    entity: str,
    entity_id: object = "",
    *,
    claim_id: int | None = None,
    level: str | None = None,
    amount: Decimal | None = None,
    on_behalf_of_id: int | None = None,
    self_approved: bool = False,
    details: dict | None = None,
) -> None:
    """Append one audit entry (FR-4.6). Old/new values for config changes go in details (FR-4.7)."""
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            entity=entity,
            entity_id=str(entity_id),
            claim_id=claim_id,
            level=level,
            amount=amount,
            on_behalf_of_id=on_behalf_of_id,
            self_approved=self_approved,
            details=_jsonable(details or {}),
        )
    )


def _jsonable(value):
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (Decimal,)):
        return str(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
