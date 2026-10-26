"""Card rows -> the API's JSON shapes. The full shape is also what a `created` event records, so
it is built once, in wire form (camelCase keys, RFC 3339 instants, YYYY-MM-DD dates)."""

from decimal import Decimal
from typing import Any

from app.repositories.card_repository import CardRow
from app.utils.time import iso_utc

CLOSED_STATES = frozenset({"delivered", "cancelled"})


def key_of(number: int) -> str:
    return f"K-{number}"


def number_of(key: str) -> int | None:
    """`K-12` -> 12 (keys are validated by the contract pattern)."""
    return int(key[2:]) if key.startswith("K-") and key[2:].isdigit() else None


def num(value: Decimal | float | int | None) -> int | float | None:
    """A stored numeric as JSON shows it: 2 for 2.00, 1.5 for 1.50."""
    if value is None:
        return None
    d = Decimal(value)
    return int(d) if d == d.to_integral_value() else float(d)


def card_wire(r: CardRow) -> dict[str, Any]:
    return {
        "id": r.id,
        "key": key_of(r.number),
        "number": r.number,
        "title": r.title,
        "description": r.description,
        "plane": r.plane,
        "state": r.state,
        "ownerId": r.owner_id,
        "assigneeId": r.assignee_id,
        "teamId": r.team_id,
        "projectId": r.project_id,
        "priority": r.priority,
        "tags": list(r.tags),
        "eta": r.eta.isoformat() if r.eta else None,
        "effortHours": num(r.effort_hours),
        "closedAt": iso_utc(r.closed_at) if r.closed_at else None,
        "loggedHours": num(r.logged_hours) or 0,
        "version": r.version,
        "createdAt": iso_utc(r.created_at),
        "updatedAt": iso_utc(r.updated_at),
    }


def summary_wire(r: CardRow) -> dict[str, Any]:
    return {
        "id": r.id,
        "key": key_of(r.number),
        "title": r.title,
        "plane": r.plane,
        "state": r.state,
        "priority": r.priority,
        "teamId": r.team_id,
        "projectId": r.project_id,
        "assigneeId": r.assignee_id,
        "eta": r.eta.isoformat() if r.eta else None,
        "closedAt": iso_utc(r.closed_at) if r.closed_at else None,
    }


def user_wire(user_id: str, name: str, email: str, role: str) -> dict[str, str]:
    return {"id": user_id, "name": name, "email": email, "role": role}
