"""Duplicate control (FR-8.1 to 8.4, A29).

Blocked: same receipt file (SHA-256), or same supplier GSTIN + invoice number.
Flagged: same amount + expense date + merchant, by anyone in the company.
Window: claims created in the last N days (setting duplicate_window_days, default 180).
"""
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import now
from app.models import Claim, ClaimLine
from app.models.enums import ClaimStatus, LineStatus, PolicyAction
from app.services import settings_service


def _describe(other: ClaimLine, kind: str, action: str, text: str) -> dict:
    return {
        "type": kind,
        "action": action,
        "message": text,
        "other_claim_id": other.claim.id,
        "other_claim_no": other.claim.claim_no,
        "other_employee": other.claim.employee.full_name,
        "other_date": other.expense_date.isoformat(),
        "other_amount": str(other.amount),
        "other_merchant": other.merchant,
        "other_status": other.claim.status,
    }


def check_line(db: Session, line: ClaimLine, claim: Claim) -> list[dict]:
    since = now() - timedelta(days=int(settings_service.get(db, "duplicate_window_days")))
    base = (
        select(ClaimLine)
        .join(Claim)
        .where(
            Claim.id != claim.id,
            Claim.created_at >= since,
            Claim.status != ClaimStatus.DRAFT,
            ClaimLine.status != LineStatus.REJECTED,
        )
    )
    flags: list[dict] = []
    seen: set[int] = set()

    def add(rows, kind, action, text):
        for other in rows:
            if other.id not in seen:
                seen.add(other.id)
                flags.append(_describe(other, kind, action, text))

    if line.receipt_hash:
        add(db.scalars(base.where(ClaimLine.receipt_hash == line.receipt_hash)).all(),
            "SAME_RECEIPT", PolicyAction.BLOCK, "The same receipt file was already claimed.")
    if line.supplier_gstin and line.invoice_no:
        add(
            db.scalars(base.where(
                func.upper(ClaimLine.supplier_gstin) == line.supplier_gstin.upper(),
                func.upper(ClaimLine.invoice_no) == line.invoice_no.upper(),
            )).all(),
            "SAME_INVOICE", PolicyAction.BLOCK, "The same supplier GSTIN and invoice number was already claimed.",
        )
    if line.merchant:
        add(
            db.scalars(base.where(
                ClaimLine.amount == line.amount,
                ClaimLine.expense_date == line.expense_date,
                func.lower(ClaimLine.merchant) == line.merchant.lower(),
            )).all(),
            "SIMILAR", PolicyAction.FLAG, "A claim with the same amount, date and merchant exists.",
        )
    return flags
