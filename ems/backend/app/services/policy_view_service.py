"""Read-only summary of categories and the company-wide limits, for the Categories & policy page."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import today
from app.models import Category, PolicyLimit
from app.services import settings_service

PERIOD = {"LINE": "per expense", "DAY": "per day", "MONTH": "per month", "YEAR": "per year"}
ACTION = {"BLOCK": "Block", "FLAG": "Allow with reason", "WARN": "Warn only"}


def inr(amount) -> str:
    """Indian digit grouping: 250000 -> 2,50,000."""
    n = f"{int(amount)}"
    head, tail = n[:-3], n[-3:]
    while len(head) > 2:
        tail = f"{head[-2:]},{tail}"
        head = head[:-2]
    return f"₹{head},{tail}" if head else f"₹{tail}"


def overview(db: Session) -> dict:
    t = today()
    limits = [l for l in db.scalars(select(PolicyLimit).where(PolicyLimit.is_active))
              if l.effective_from <= t and (l.effective_to is None or l.effective_to >= t)]
    cats = db.scalars(select(Category).where(Category.is_active, Category.kind == "EXPENSE")
                      .order_by(Category.group_name, Category.name)).all()
    rows = []
    for c in cats:
        mine = [l for l in limits if l.category_id == c.id]
        rows.append({
            "id": c.id,
            "group": c.group_name or "Other",
            "name": c.name,
            "description": c.description,
            "limits": [{
                "text": f"{inr(l.amount)} {PERIOD[l.period]}",
                "applies_to": "Everyone" if l.scope == "COMPANY" else f"{l.scope.title()} {l.scope_value}",
                "over_limit": ACTION[l.action],
            } for l in sorted(mine, key=lambda l: ("EMPLOYEE", "DEPARTMENT", "COMPANY").index(l.scope))],
            "receipt": ("Not needed" if not c.receipt_required
                        else f"Above {inr(c.receipt_threshold)}" if c.receipt_threshold is not None else "Always"),
            "extra_field": c.extra_field_label,
        })
    return {"categories": rows, "late_submission_days": settings_service.get(db, "late_submission_days"),
            "level2_above": settings_service.get(db, "level2_above")}
