"""Administrator dashboard, exports and audit log (FR-9.1 to 9.5)."""
import csv
import io
from collections import defaultdict
from datetime import date, datetime, time
from decimal import Decimal
from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.time import IST
from app.models import ApprovalStep, AuditLog, Claim, ClaimLine
from app.models.enums import ClaimStatus, ClaimType, Level, LineStatus, StepStatus

SPEND_STATUSES = (ClaimStatus.READY_FOR_PAYROLL, ClaimStatus.SENT_TO_PAYROLL, ClaimStatus.PAID, ClaimStatus.PAYMENT_FAILED)


def _add(bucket: dict, key, amount: Decimal) -> None:
    bucket[key] = bucket.get(key, Decimal(0)) + amount


def dashboard(db: Session, start: date | None, end: date | None) -> dict:
    q = (select(Claim).where(Claim.type == ClaimType.EXPENSE, Claim.status.in_(SPEND_STATUSES))
         .options(selectinload(Claim.lines).selectinload(ClaimLine.category), selectinload(Claim.employee)))
    claims = db.scalars(q).all()
    by_month, by_cat, by_dept, by_loc = {}, {}, {}, {}
    total = Decimal(0)
    for c in claims:
        for l in c.lines:
            if l.status != LineStatus.APPROVED or (start and l.expense_date < start) or (end and l.expense_date > end):
                continue
            amt = l.approved_amount or Decimal(0)
            total += amt
            _add(by_month, l.expense_date.strftime("%Y-%m"), amt)
            _add(by_cat, l.category.name, amt)
            _add(by_dept, c.employee.department or "-", amt)
            _add(by_loc, c.employee.location or "-", amt)

    pending = db.scalars(select(ApprovalStep).where(ApprovalStep.status == StepStatus.PENDING)).all()
    pending_by_level = defaultdict(int)
    for s in pending:
        pending_by_level[s.level] += 1

    done = db.scalars(select(ApprovalStep).where(ApprovalStep.status.in_((StepStatus.APPROVED, StepStatus.REJECTED)),
                                                  ApprovalStep.acted_at.is_not(None), ~ApprovalStep.self_approved)).all()
    hours = defaultdict(list)
    for s in done:
        hours[s.level].append((s.acted_at - s.activated_at).total_seconds() / 3600)
    avg_hours = {lvl: round(sum(v) / len(v), 1) for lvl, v in hours.items() if v}

    l2 = defaultdict(lambda: {"count": 0, "amount": Decimal(0)})
    for s in done:
        if s.level == Level.L2 and s.status == StepStatus.APPROVED and s.line:
            key = s.line.category.name
            l2[key]["count"] += 1
            l2[key]["amount"] += s.approved_amount or 0

    self_rows = defaultdict(lambda: {"count": 0, "amount": Decimal(0)})
    for c in db.scalars(select(Claim).where(Claim.self_approved, Claim.submitted_at.is_not(None))).all():
        key = (c.employee.full_name, c.submitted_at.astimezone(IST).strftime("%Y-%m"))
        self_rows[key]["count"] += 1
        self_rows[key]["amount"] += c.total_claimed

    violations = defaultdict(int)
    gst = {"eligible": Decimal(0), "not_eligible": Decimal(0)}
    for l in db.scalars(select(ClaimLine).join(Claim).where(Claim.status.in_(ClaimStatus.ACTIVE))).all():
        for f in l.policy_flags:
            violations[f["action"]] += 1
        g = (l.cgst or 0) + (l.sgst or 0) + (l.igst or 0)
        if g:
            gst["eligible" if l.gst_credit_eligible else "not_eligible"] += g

    def rows(d):
        return [{"key": k, "amount": float(v)} for k, v in sorted(d.items())]

    return {
        "total_spend": float(total),
        "by_month": rows(by_month), "by_category": rows(by_cat), "by_department": rows(by_dept),
        "by_location": rows(by_loc),
        "pending_by_level": dict(pending_by_level), "avg_hours_by_level": avg_hours,
        "level2_by_category": [{"key": k, "count": v["count"], "amount": float(v["amount"])} for k, v in l2.items()],
        "self_approved": [{"person": k[0], "month": k[1], "count": v["count"], "amount": float(v["amount"])}
                          for k, v in sorted(self_rows.items())],
        "policy_violations": dict(violations),
        "gst": {k: float(v) for k, v in gst.items()},
    }


def export_claims_csv(claims: list[Claim]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Claim", "Title", "Employee", "Department", "Project", "Submitted", "Items", "Claimed", "Approved",
                "Status", "Waiting on", "Payment month"])
    for c in claims:
        w.writerow([c.claim_no, c.title, c.employee.full_name, c.employee.department, c.project,
                    c.submitted_at.astimezone(IST).date().isoformat() if c.submitted_at else "", c.line_count,
                    c.total_claimed, c.total_approved if c.total_approved is not None else "", c.stage, c.waiting_on,
                    c.payment_month or ""])
    return buf.getvalue().encode("utf-8-sig")


def export_claims(db: Session, claims: list[Claim]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Claims"
    ws.append(["Claim", "Type", "Employee", "Code", "Department", "Line", "Category", "GL code", "Expense date", "Merchant",
               "Claimed", "Approved", "Line status", "GST", "GST credit", "Claim status", "Self-approved", "Payment month"])
    for c in claims:
        for i, l in enumerate(c.lines, start=1):
            ws.append([c.claim_no, c.type, c.employee.full_name, c.employee.employee_code, c.employee.department, i,
                       l.category.name, l.category.gl_code, l.expense_date, l.merchant, float(l.amount),
                       float(l.approved_amount) if l.approved_amount is not None else None, l.status,
                       float((l.cgst or 0) + (l.sgst or 0) + (l.igst or 0)),
                       {True: "Eligible", False: "Not eligible"}.get(l.gst_credit_eligible, ""), c.status,
                       "Self-approved" if c.self_approved else "", c.payment_month])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def audit_query(db: Session, user_id: int | None, claim_no: str | None, level: str | None,
                start: date | None, end: date | None, limit: int = 1000) -> list[AuditLog]:
    q = select(AuditLog).order_by(AuditLog.at.desc()).limit(limit)
    if user_id:
        q = q.where(AuditLog.actor_id == user_id)
    if claim_no:
        claim = db.scalars(select(Claim).where(Claim.claim_no == claim_no.strip().upper())).first()
        q = q.where(AuditLog.claim_id == (claim.id if claim else -1))
    if level:
        q = q.where(AuditLog.level == level)
    if start:
        q = q.where(AuditLog.at >= datetime.combine(start, time.min, IST))
    if end:
        q = q.where(AuditLog.at <= datetime.combine(end, time.max, IST))
    return list(db.scalars(q))


def claim_numbers(db: Session, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    return dict(db.execute(select(Claim.id, Claim.claim_no).where(Claim.id.in_(ids))).all())


def export_audit(rows: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Audit log"
    ws.append(["When (IST)", "Who", "On behalf of", "Action", "Entity", "Entity id", "Claim", "Level", "Amount", "Self-approved", "Details"])
    for r in rows:
        ws.append([r["at"].astimezone(IST).replace(tzinfo=None), r["actor_name"], r["on_behalf_of_name"], r["action"], r["entity"],
                   r["entity_id"], r["claim_no"], r["level"], float(r["amount"]) if r["amount"] is not None else None,
                   "Yes" if r["self_approved"] else "", str(r["details"]) if r["details"] else ""])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
