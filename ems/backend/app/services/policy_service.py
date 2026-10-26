"""Policy engine (FR-5.7 to 5.12, A27).

A limit applies per expense line, per day, per calendar month or per financial year. When several limits match, the most
specific scope wins: EMPLOYEE > DEPARTMENT > COMPANY. The limit active on the expense
date is used.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import Category, Claim, ClaimLine, PolicyLimit, User
from app.models.enums import ClaimStatus, LineStatus

SCOPE_ORDER = ("EMPLOYEE", "DEPARTMENT", "COMPANY")


@dataclass
class LineInput:
    """What the policy engine needs from a line (a saved line or a form row being typed)."""

    key: object  # index or line id, echoed back
    category_id: int
    expense_date: date
    amount: Decimal


def _scope_value(user: User, scope: str) -> str | None:
    return {"EMPLOYEE": str(user.id), "DEPARTMENT": user.department, "COMPANY": None}[scope]


def _limit_for(db: Session, user: User, category_id: int, period: str, on: date) -> PolicyLimit | None:
    rows = db.scalars(
        select(PolicyLimit).where(
            PolicyLimit.is_active,
            PolicyLimit.category_id == category_id,
            PolicyLimit.period == period,
            PolicyLimit.effective_from <= on,
            or_(PolicyLimit.effective_to.is_(None), PolicyLimit.effective_to >= on),
        )
    ).all()
    for scope in SCOPE_ORDER:
        for r in rows:
            if r.scope == scope and (scope == "COMPANY" or r.scope_value == _scope_value(user, scope)):
                return r
    return None


def _period(period: str, d: date) -> tuple[date, date, str]:
    """The date range a DAY / MONTH / YEAR limit covers, and its label. YEAR = Indian financial year (April-March)."""
    if period == "DAY":
        return d, d, f"per day ({d:%d %b %Y})"
    if period == "MONTH":
        nxt = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
        return d.replace(day=1), nxt - timedelta(days=1), f"per month ({d:%m/%Y})"
    fy = d.year if d.month >= 4 else d.year - 1
    return date(fy, 4, 1), date(fy + 1, 3, 31), f"per year (FY {fy}-{str(fy + 1)[2:]})"


def _spent(db: Session, user: User, category_id: int, start: date, end: date, exclude_claim_id: int | None) -> Decimal:
    q = (
        select(func.coalesce(func.sum(func.coalesce(ClaimLine.approved_amount, ClaimLine.amount)), 0))
        .join(Claim)
        .where(
            Claim.employee_id == user.id,
            Claim.status.in_(ClaimStatus.ACTIVE),
            ClaimLine.status != LineStatus.REJECTED,
            ClaimLine.category_id == category_id,
            ClaimLine.expense_date >= start,
            ClaimLine.expense_date <= end,
        )
    )
    if exclude_claim_id:
        q = q.where(Claim.id != exclude_claim_id)
    return Decimal(db.scalar(q) or 0)


def _violation(limit: PolicyLimit, category: Category, total: Decimal, period_label: str) -> dict:
    over = total - limit.amount
    return {
        "rule_id": limit.id,
        "action": limit.action,
        "limit": str(limit.amount),
        "over": str(over),
        "message": f"{category.name}: limit ₹{limit.amount:,.2f} {period_label}; over by ₹{over:,.2f}.",
    }


def check(db: Session, user: User, lines: list[LineInput], exclude_claim_id: int | None = None) -> dict[object, list[dict]]:
    """Returns {line key: [violations]} for every line passed in."""
    result: dict[object, list[dict]] = {ln.key: [] for ln in lines}
    categories = {c.id: c for c in db.scalars(select(Category)).all()}

    for ln in lines:
        cat = categories.get(ln.category_id)
        if not cat or cat.kind != "EXPENSE":
            continue
        limit = _limit_for(db, user, ln.category_id, "LINE", ln.expense_date)
        if limit and ln.amount > limit.amount:
            result[ln.key].append(_violation(limit, cat, ln.amount, "per expense"))

    for period in ("DAY", "MONTH", "YEAR"):
        groups: dict[tuple, list[LineInput]] = defaultdict(list)
        for ln in lines:
            start_d, end_d, _ = _period(period, ln.expense_date)
            groups[(ln.category_id, start_d, end_d)].append(ln)
        for (cat_id, start_d, end_d), members in groups.items():
            cat = categories.get(cat_id)
            if not cat or cat.kind != "EXPENSE":
                continue
            limit = _limit_for(db, user, cat_id, period, members[0].expense_date)
            if not limit:
                continue
            total = _spent(db, user, cat_id, start_d, end_d, exclude_claim_id) + sum(m.amount for m in members)
            if total > limit.amount:
                v = _violation(limit, cat, total, _period(period, members[0].expense_date)[2])
                for m in members:
                    result[m.key].append(v)
    return result
