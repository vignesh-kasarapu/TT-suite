"""Mirrors backend/src/services/audit.service.js — NFR-12: every mutating
service action gets one append-only audit_log row."""
import json
from typing import Any

from sqlalchemy.orm import Session

from app.dao import audit_dao


def record(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: Any,
    actor_id: int | None = None,
    is_system_actor: bool = False,
    prior_value: Any = None,
    new_value: Any = None,
) -> None:
    audit_dao.create(
        db,
        actor_id=actor_id,
        is_system_actor=is_system_actor,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id),
        prior_value=json.dumps(prior_value, default=str) if prior_value is not None else None,
        new_value=json.dumps(new_value, default=str) if new_value is not None else None,
    )
