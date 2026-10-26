"""Payroll batches, payment results and cash advance settlement (FR-6.12 to 6.14, A43 to A45)."""
from datetime import timedelta
from decimal import Decimal
from io import BytesIO

from fastapi import HTTPException
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import now, today
from app.models import Claim, PayrollBatch, User
from app.models.enums import AdvanceStatus, ClaimStatus, ClaimType
from app.services import audit_service, notification_service, settings_service


# ---------- cash advances ----------

def apply_advance_deduction(db: Session, claim: Claim) -> None:
    """A44: deduct the employee's open advance balance from this claim's payout, oldest advance first."""
    advances = db.scalars(
        select(Claim)
        .where(Claim.employee_id == claim.employee_id, Claim.type == ClaimType.ADVANCE,
               Claim.advance_status == AdvanceStatus.OPEN, Claim.advance_balance > 0)
        .order_by(Claim.finance_approved_at)
    ).all()
    remaining = claim.total_approved
    deducted = Decimal(0)
    for adv in advances:
        if remaining <= 0:
            break
        take = min(adv.advance_balance, remaining)
        adv.advance_balance -= take
        remaining -= take
        deducted += take
        if adv.advance_balance == 0:
            adv.advance_status = AdvanceStatus.SETTLED
        audit_service.log(db, None, "ADVANCE_ADJUSTED", "claim", adv.id, claim_id=adv.id, amount=take,
                          details={"against": claim.claim_no})
    claim.advance_deducted = deducted
    claim.payout_amount = remaining
    if remaining == 0:
        claim.status = ClaimStatus.PAID
        claim.paid_at = now()


def open_advance(db: Session, employee_id: int) -> Claim | None:
    """An advance still in flight or with a balance blocks a new one (A41)."""
    return db.scalars(
        select(Claim).where(
            Claim.employee_id == employee_id,
            Claim.type == ClaimType.ADVANCE,
            Claim.status.in_((*ClaimStatus.EDITABLE, *ClaimStatus.ACTIVE)),
            (Claim.advance_status.is_(None)) | (Claim.advance_status.in_((AdvanceStatus.OPEN, AdvanceStatus.RECOVERY_REQUESTED))),
        )
    ).first()


def advances(db: Session) -> list[dict]:
    rows = db.scalars(
        select(Claim)
        .where(Claim.type == ClaimType.ADVANCE, Claim.advance_status.is_not(None))
        .order_by(Claim.finance_approved_at.desc())
    ).all()
    settle_days = int(settings_service.get(db, "advance_settle_days"))
    out = []
    for c in rows:
        due = c.expected_settlement_date
        if c.finance_approved_at:
            limit = c.finance_approved_at.date() + timedelta(days=settle_days)
            due = min(due, limit) if due else limit
        out.append({"claim": c, "due_date": due,
                    "overdue": c.advance_status == AdvanceStatus.OPEN and due is not None and due < today()})
    return out


def request_recovery(db: Session, user: User, claim_id: int) -> Claim:
    adv = db.get(Claim, claim_id)
    if not adv or adv.type != ClaimType.ADVANCE or adv.advance_status != AdvanceStatus.OPEN:
        raise HTTPException(400, "Only an open advance can be recovered.")
    adv.advance_status = AdvanceStatus.RECOVERY_REQUESTED
    audit_service.log(db, user.id, "ADVANCE_RECOVERY_REQUESTED", "claim", adv.id, claim_id=adv.id, amount=adv.advance_balance)
    notification_service.notify(db, adv.employee_id,
                                f"₹{adv.advance_balance:,.2f} of advance {adv.claim_no} will be recovered in the next payroll.",
                                f"/claims/{adv.id}")
    db.commit()
    return adv


# ---------- payroll ----------

def _ready(db: Session, month: str) -> list[Claim]:
    return list(db.scalars(
        select(Claim)
        .where(Claim.status == ClaimStatus.READY_FOR_PAYROLL, Claim.payment_month <= month)
        .order_by(Claim.employee_id, Claim.id)
    ))


def _recoveries(db: Session) -> list[Claim]:
    return list(db.scalars(select(Claim).where(Claim.advance_status == AdvanceStatus.RECOVERY_REQUESTED)))


def batch_preview(db: Session, month: str) -> dict:
    claims = _ready(db, month)
    recs = _recoveries(db)
    return {
        "month": month,
        "claims": claims,
        "claim_count": len(claims),
        "total_amount": sum((c.payout_amount for c in claims), Decimal(0)),
        "recoveries": recs,
        "recovery_total": sum((r.advance_balance for r in recs), Decimal(0)),
    }


def send_batch(db: Session, user: User, month: str, expected_count: int) -> PayrollBatch:
    """FR-6.12: one batch, after the reviewer has seen the summary. expected_count guards against
    claims arriving between preview and confirm."""
    preview = batch_preview(db, month)
    if preview["claim_count"] == 0 and not preview["recoveries"]:
        raise HTTPException(400, "Nothing is ready for payroll.")
    if preview["claim_count"] != expected_count:
        raise HTTPException(409, "The list changed since you opened the summary. Review it again.")
    batch = PayrollBatch(
        month=month, created_by_id=user.id, claim_count=preview["claim_count"],
        total_amount=preview["total_amount"], recovery_total=preview["recovery_total"],
        recoveries=[{"claim_no": r.claim_no, "employee_code": r.employee.employee_code,
                     "employee": r.employee.full_name, "amount": str(r.advance_balance)} for r in preview["recoveries"]],
    )
    db.add(batch)
    db.flush()
    for c in preview["claims"]:
        c.status = ClaimStatus.SENT_TO_PAYROLL  # FR-6.13: locked from here
        c.payroll_batch_id = batch.id
    for r in preview["recoveries"]:
        r.advance_status = AdvanceStatus.RECOVERED
        r.advance_balance = Decimal(0)
    audit_service.log(db, user.id, "PAYROLL_BATCH_SENT", "payroll_batch", batch.id, amount=batch.total_amount,
                      details={"month": month, "claims": batch.claim_count, "recoveries": str(batch.recovery_total)})
    db.commit()
    return batch


def batches(db: Session) -> list[PayrollBatch]:
    return list(db.scalars(select(PayrollBatch).order_by(PayrollBatch.created_at.desc())))


def mark_paid(db: Session, user: User, claim_id: int) -> Claim:
    c = _sent(db, claim_id)
    c.status = ClaimStatus.PAID
    c.paid_at = now()
    c.failure_reason = None
    audit_service.log(db, user.id, "PAID", "claim", c.id, claim_id=c.id, amount=c.payout_amount)
    notification_service.notify(db, c.employee_id, f"{c.claim_no} was paid: ₹{c.payout_amount:,.2f}.", f"/claims/{c.id}", "PAID")
    db.commit()
    return c


def mark_failed(db: Session, user: User, claim_id: int, reason: str) -> Claim:
    if not reason.strip():
        raise HTTPException(400, "Give the failure reason from payroll.")
    c = _sent(db, claim_id)
    c.status = ClaimStatus.PAYMENT_FAILED
    c.failure_reason = reason
    audit_service.log(db, user.id, "PAYMENT_FAILED", "claim", c.id, claim_id=c.id, details={"reason": reason})
    notification_service.notify(db, c.employee_id, f"Payment for {c.claim_no} failed. Finance is looking into it.", f"/claims/{c.id}")
    db.commit()
    return c


def retry(db: Session, user: User, claim_id: int) -> Claim:
    c = db.get(Claim, claim_id)
    if not c or c.status != ClaimStatus.PAYMENT_FAILED:
        raise HTTPException(400, "Only a failed payment can be retried.")
    c.status = ClaimStatus.READY_FOR_PAYROLL
    c.payroll_batch_id = None
    audit_service.log(db, user.id, "PAYMENT_RETRY", "claim", c.id, claim_id=c.id)
    db.commit()
    return c


def _sent(db: Session, claim_id: int) -> Claim:
    c = db.get(Claim, claim_id)
    if not c or c.status != ClaimStatus.SENT_TO_PAYROLL:
        raise HTTPException(400, "This claim is not with payroll.")
    return c


def payment_queue(db: Session) -> dict:
    def by(status):
        return list(db.scalars(select(Claim).where(Claim.status == status).order_by(Claim.id)))
    return {"ready": by(ClaimStatus.READY_FOR_PAYROLL), "sent": by(ClaimStatus.SENT_TO_PAYROLL),
            "failed": by(ClaimStatus.PAYMENT_FAILED)}


def export_batch(db: Session, batch_id: int) -> bytes:
    """Payroll file (FR-7.7 file backup): one row per claim, recoveries as negative rows."""
    batch = db.get(PayrollBatch, batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found.")
    claims = db.scalars(select(Claim).where(Claim.payroll_batch_id == batch.id).order_by(Claim.id)).all()
    wb = Workbook()
    ws = wb.active
    ws.title = f"Payroll {batch.month}"
    ws.append(["Employee code", "Employee", "Claim", "Type", "Approved", "Advance adjusted", "Payout", "Taxable", "Status"])
    for c in claims:
        taxable = any(l.category.taxable for l in c.lines if l.status == "APPROVED")
        ws.append([c.employee.employee_code, c.employee.full_name, c.claim_no, c.type, float(c.total_approved or 0),
                   float(c.advance_deducted or 0), float(c.payout_amount or 0), "Yes" if taxable else "No", c.status])
    for r in batch.recoveries:
        ws.append([r["employee_code"], r["employee"], r["claim_no"], "ADVANCE RECOVERY", None, None, -float(r["amount"]), "No", "RECOVERY"])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
