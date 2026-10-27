import json
import logging
from typing import Any

from app.common.exceptions import current_iso_timestamp

audit_logger = logging.getLogger("ams.audit")


def log_audit_event(
    action: str,
    actor_user_id: int,
    asset_id: int,
    asset_tag: str | None = None,
    target_user_id: int | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    timestamp = current_iso_timestamp()
    resolved_user_id = target_user_id if target_user_id is not None else actor_user_id
    event: dict[str, Any] = {
        "event": "asset_lifecycle_audit",
        "action": action,
        "actor_user_id": actor_user_id,
        "user_id": resolved_user_id,
        "asset_id": asset_id,
        "timestamp": timestamp,
    }
    if asset_tag is not None:
        event["asset_tag"] = asset_tag
    if extra:
        event.update(extra)

    audit_logger.info(
        "AUDIT action=%s actor_user_id=%s user_id=%s asset_id=%s timestamp=%s payload=%s",
        action,
        actor_user_id,
        resolved_user_id,
        asset_id,
        timestamp,
        json.dumps(event),
    )
    return event
