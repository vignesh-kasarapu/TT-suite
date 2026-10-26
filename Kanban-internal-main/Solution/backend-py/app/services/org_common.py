"""Helpers the org services share: patch diffing into events, event pages, name refs."""

from datetime import date
from typing import Any

from app.repositories.event_repository import EventInput, OrgEventRow
from app.schemas.org_schema import OrgEventPage


def jsonable(value: Any) -> Any:
    """Event values are stored as JSON; calendar dates as YYYY-MM-DD, as always."""
    return value.isoformat() if isinstance(value, date) else value


def diff_patch(
    current: dict[str, Any], changes: dict[str, Any], fields: list[tuple[str, str, str]]
) -> tuple[dict[str, Any], list[EventInput]]:
    """For each (key, column, event) the patch carries and that differs from the row: the
    column to set and the event to write. Fields left out of the patch are left alone."""
    values: dict[str, Any] = {}
    events: list[EventInput] = []
    for key, column, event in fields:
        if key not in changes or current[key] == changes[key]:
            continue
        values[column] = changes[key]
        events.append(EventInput(event, jsonable(current[key]), jsonable(changes[key])))
    return values, events


def event_page(total: int, offset: int, limit: int, rows: list[OrgEventRow]) -> OrgEventPage:
    return OrgEventPage.model_validate(
        {
            "total": total,
            "offset": offset,
            "limit": limit,
            "items": [
                {
                    "id": r.id,
                    "groupId": r.group_id,
                    "field": r.field,
                    "oldValue": r.old_value,
                    "newValue": r.new_value,
                    "actor": {
                        "id": r.actor_id,
                        "name": r.actor_name,
                        "email": r.actor_email,
                        "role": r.actor_role,
                    },
                    "createdAt": r.created_at,
                }
                for r in rows
            ],
        }
    )
