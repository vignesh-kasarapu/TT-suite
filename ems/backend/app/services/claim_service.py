"""Employee side: submit (all or nothing, so there are no drafts), withdraw, cash advances, receipts, visibility (FR-1.6, FR-6.1 to 6.8)."""
import hashlib
from datetime import date, datetime, time
import re
import uuid
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.time import IST, now, today
from app.models import ApprovalStep, Category, Claim, ClaimLine, User
from app.models.enums import ClaimStatus, ClaimType, LineStatus, PolicyAction, Role, StepStatus, can_self_serve
from app.schemas.claim import AdvanceIn, ClaimIn, LineIn
from app.services import (audit_service, delegation_service, duplicate_service, finance_service, policy_service,
                          routing_service, settings_service)

GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
ALLOWED_RECEIPTS = {".jpg", ".jpeg", ".png", ".pdf", ".webp", ".heic"}
MAX_RECEIPT_BYTES = 3 * 1024 * 1024
LINE_FIELDS = ("category_id", "expense_date", "merchant", "description", "amount", "cost_centre", "state", "invoice_no",
               "supplier_gstin", "buyer_gstin", "cgst", "sgst", "igst", "extra_field_value", "justification",
               "receipt_path", "receipt_name")


# ---------- receipts ----------

def _upload_dir() -> Path:
    path = Path(settings.upload_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


async def save_receipt(file: UploadFile) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_RECEIPTS:
        raise HTTPException(400, "Upload a photo (JPG, PNG, WEBP, HEIC) or a PDF.")
    data = await file.read()
    if len(data) > MAX_RECEIPT_BYTES:
        raise HTTPException(400, "The file is larger than 3 MB.")
    name = f"{uuid.uuid4().hex}{ext}"
    (_upload_dir() / name).write_bytes(data)
    return {"receipt_path": name, "receipt_name": file.filename}


def _hash_receipt(name: str | None) -> str | None:
    if not name:
        return None
    path = _upload_dir() / Path(name).name  # never trust a client path
    if not path.is_file():
        raise HTTPException(400, "A receipt upload was not found. Upload it again.")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def receipt_file(db: Session, user: User, claim_id: int, line_id: int) -> tuple[Path, str]:
    claim = get_visible(db, user, claim_id)
    line = next((l for l in claim.lines if l.id == line_id), None)
    if not line or not line.receipt_path:
        raise HTTPException(404, "No receipt on this line.")
    return _upload_dir() / Path(line.receipt_path).name, line.receipt_name or line.receipt_path


# ---------- visibility ----------

def can_view(db: Session, user: User, claim: Claim) -> bool:
    if Role.ADMIN in user.roles or claim.employee_id == user.id:
        return True
    if Role.FINANCE in user.roles and claim.status in ClaimStatus.FINANCE_VISIBLE:
        return True
    if claim.employee.manager_id == user.id:  # own team
        return True
    for s in claim.steps:
        if user.id in (s.approver_id, s.acted_by_id, s.on_behalf_of_id):
            return True
        if s.status == StepStatus.PENDING and delegation_service.can_act(db, user, s):
            return True
    return False


def get_visible(db: Session, user: User, claim_id: int) -> Claim:
    claim = db.get(Claim, claim_id)
    if not claim or not can_view(db, user, claim):
        raise HTTPException(404, "Claim not found.")
    return claim


def list_claims(db: Session, user: User, scope: str, status: str | None, q_text: str | None = None,
                department: str | None = None, since: date | None = None) -> list[Claim]:
    q = select(Claim).order_by(Claim.updated_at.desc())
    if q_text:  # search title, claim number, project, employee
        like = f"%{q_text.strip()}%"
        q = q.where(or_(Claim.title.ilike(like), Claim.claim_no.ilike(like), Claim.project.ilike(like),
                        Claim.employee_id.in_(select(User.id).where(User.full_name.ilike(like)))))
    if department:
        q = q.where(Claim.employee_id.in_(select(User.id).where(User.department == department)))
    if since:
        q = q.where(Claim.created_at >= datetime.combine(since, time.min, IST))
    if scope == "mine":
        q = q.where(Claim.employee_id == user.id, Claim.status != ClaimStatus.DRAFT)
    elif scope == "team":
        q = q.join(User, Claim.employee_id == User.id).where(User.manager_id == user.id, Claim.status != ClaimStatus.DRAFT)
    elif scope == "routed":
        routed = select(ApprovalStep.claim_id).where(
            or_(ApprovalStep.approver_id == user.id, ApprovalStep.acted_by_id == user.id, ApprovalStep.on_behalf_of_id == user.id))
        q = q.where(Claim.id.in_(routed), Claim.employee_id != user.id)
    elif scope == "finance" and Role.FINANCE in user.roles:
        q = q.where(Claim.status.in_(ClaimStatus.FINANCE_VISIBLE))
    elif scope == "all" and Role.ADMIN in user.roles:
        q = q.where(Claim.status != ClaimStatus.DRAFT)
    else:
        raise HTTPException(403, "You do not have access to this list.")
    if status:
        q = q.where(Claim.status == status)
    return list(db.scalars(q.limit(500)))


# ---------- saving and submitting ----------

def _own_editable(db: Session, user: User, claim_id: int) -> Claim:
    claim = db.get(Claim, claim_id)
    if not claim or claim.employee_id != user.id:
        raise HTTPException(404, "Claim not found.")
    if claim.status not in ClaimStatus.EDITABLE:
        raise HTTPException(400, "This claim can no longer be edited.")
    return claim


def _apply_lines(db: Session, claim: Claim, rows: list[LineIn]) -> None:
    existing = {l.id: l for l in claim.lines}
    keep = []
    for row in rows:
        line = existing.get(row.id) if row.id else None
        if not line:
            line = ClaimLine(status=LineStatus.DRAFT)
            claim.lines.append(line)
        for f in LINE_FIELDS:
            setattr(line, f, getattr(row, f))
        line.supplier_gstin = line.supplier_gstin.strip().upper()
        line.buyer_gstin = line.buyer_gstin.strip().upper()
        keep.append(line)
    for line in list(claim.lines):
        if line not in keep:
            claim.lines.remove(line)


def _save(db: Session, user: User, data: ClaimIn, claim_id: int | None = None) -> Claim:
    """Writes the form into the session without committing; submit() commits only if the claim passes."""
    if claim_id:
        claim = _own_editable(db, user, claim_id)
        if claim.type != ClaimType.EXPENSE:
            raise HTTPException(400, "Edit cash advances from the advance form.")
    else:
        claim = Claim(employee_id=user.id, type=ClaimType.EXPENSE, status=ClaimStatus.DRAFT)
        db.add(claim)
    claim.title = data.title.strip() or "Expense claim"
    claim.project = data.project.strip()
    claim.purpose = data.purpose.strip()
    _apply_lines(db, claim, data.lines)
    claim.total_claimed = sum((l.amount for l in claim.lines), Decimal(0))
    db.flush()
    if not claim.claim_no:
        claim.claim_no = f"CLM-{claim.id:06d}"
    return claim


def submit_claim(db: Session, user: User, data: ClaimIn, claim_id: int | None = None) -> Claim:
    return submit(db, user, _save(db, user, data, claim_id).id)


# ---------- validation ----------

def _validate_claim(db: Session, claim: Claim) -> list[str]:
    """Claim-level rules set in Admin > Settings."""
    errors: list[str] = []
    if claim.type != ClaimType.EXPENSE:
        return errors
    projects = settings_service.get(db, "projects") or []
    if settings_service.get(db, "require_project") and not claim.project:
        errors.append("Choose a project for this claim.")
    if claim.project and projects and claim.project not in projects:
        errors.append(f"Project {claim.project} is not in the list. Choose another.")
    if settings_service.get(db, "require_purpose") and not claim.purpose:
        errors.append("Give the business purpose of this claim.")
    return errors


def receipt_needed(cat: Category, amount: Decimal) -> bool:
    return cat.receipt_required and (cat.receipt_threshold is None or amount > cat.receipt_threshold)


def _validate_lines(db: Session, user: User, claim: Claim) -> list[str]:
    errors: list[str] = _validate_claim(db, claim)
    gstins = set((settings_service.get(db, "company_gstins") or {}).values())
    cost_centres = settings_service.get(db, "cost_centres") or []
    late_days = int(settings_service.get(db, "late_submission_days") or 0)
    for i, line in enumerate(claim.lines, start=1):
        cat = db.get(Category, line.category_id)
        label = f"Line {i}"
        if not cat or not cat.is_active:
            errors.append(f"{label}: choose an active category.")
            continue
        line.category = cat
        if claim.type == ClaimType.EXPENSE and cat.kind != "EXPENSE":
            errors.append(f"{label}: {cat.name} cannot be used on an expense claim.")
        if line.amount <= 0:
            errors.append(f"{label}: amount must be more than zero.")
        if line.expense_date > today():
            errors.append(f"{label}: the expense date is in the future.")
        if claim.type == ClaimType.EXPENSE and late_days and (today() - line.expense_date).days > late_days:
            errors.append(f"{label}: expenses older than {late_days} days cannot be claimed.")
        if claim.type == ClaimType.EXPENSE and receipt_needed(cat, line.amount) and not line.receipt_path:
            errors.append(f"{label}: {cat.name} needs a receipt"
                          + (f" above ₹{cat.receipt_threshold:,.0f}." if cat.receipt_threshold is not None else "."))
        if line.cost_centre and cost_centres and line.cost_centre not in cost_centres:
            errors.append(f"{label}: cost centre {line.cost_centre} is not in the list.")
        if cat.extra_field_label and not line.extra_field_value.strip():
            errors.append(f"{label}: fill in {cat.extra_field_label}.")
        for field in ("supplier_gstin", "buyer_gstin"):
            value = getattr(line, field)
            if value and not GSTIN_RE.match(value):
                errors.append(f"{label}: {field.replace('_', ' ')} {value} is not a valid GSTIN.")
        gst_total = (line.cgst or 0) + (line.sgst or 0) + (line.igst or 0)
        if gst_total > line.amount:
            errors.append(f"{label}: GST cannot be more than the invoice amount.")
        # FR-5.13 / FR-7.5: marks credit eligibility only; the reimbursed amount never changes.
        line.gst_credit_eligible = bool(cat.gst_credit_eligible and gst_total > 0 and line.buyer_gstin in gstins)
        line.receipt_hash = _hash_receipt(line.receipt_path)
    return errors


def policy_preview(db: Session, user: User, rows: list[LineIn], claim_id: int | None) -> list[list[dict]]:
    """FR-5.10: live check while the form is being filled."""
    inputs = [policy_service.LineInput(i, r.category_id, r.expense_date, r.amount) for i, r in enumerate(rows)]
    result = policy_service.check(db, user, inputs, exclude_claim_id=claim_id)
    return [result[i] for i in range(len(rows))]


def submit(db: Session, user: User, claim_id: int) -> Claim:
    claim = _own_editable(db, user, claim_id)
    if not claim.lines:
        raise HTTPException(400, "Add at least one expense line.")
    errors = _validate_lines(db, user, claim)
    if errors:
        raise HTTPException(400, {"message": "Fix these before submitting.", "errors": errors})

    inputs = [policy_service.LineInput(l.id, l.category_id, l.expense_date, l.amount) for l in claim.lines]
    violations = policy_service.check(db, user, inputs, exclude_claim_id=claim.id)
    for i, line in enumerate(claim.lines, start=1):
        line.policy_flags = violations[line.id]
        line.duplicate_flags = duplicate_service.check_line(db, line, claim)
        line.duplicate_cleared_reason = None
        for v in line.policy_flags + line.duplicate_flags:
            if v["action"] == PolicyAction.BLOCK:
                errors.append(f"Line {i}: {v['message']}")
        if any(v["action"] == PolicyAction.FLAG for v in line.policy_flags) and not line.justification.strip():
            errors.append(f"Line {i}: give a reason for going over the limit.")
    if errors:
        db.rollback()
        raise HTTPException(400, {"message": "This claim cannot be submitted.", "errors": errors})

    claim.total_claimed = sum((l.amount for l in claim.lines), Decimal(0))
    claim.round += 1
    claim.submitted_at = now()
    claim.return_reason = None
    audit_service.log(db, user.id, "SUBMITTED" if claim.round == 1 else "RESUBMITTED", "claim", claim.id,
                      claim_id=claim.id, amount=claim.total_claimed)
    routing_service.start(db, claim)
    db.commit()
    return claim


# ---------- cash advances ----------

def create_advance(db: Session, user: User, data: AdvanceIn) -> Claim:
    """A39 to A42: Managers and Admins only, one open advance, under the maximum, routed like a claim."""
    if not can_self_serve(user.roles):
        raise HTTPException(403, "Only Managers and Admins can request cash advances.")
    if finance_service.open_advance(db, user.id):
        raise HTTPException(400, "You already have an open cash advance. Settle it first.")
    max_amount = Decimal(str(settings_service.get(db, "advance_max_amount")))
    if data.amount > max_amount:
        raise HTTPException(400, f"The most you can request is ₹{max_amount:,.2f}.")
    if data.expected_settlement_date < today():
        raise HTTPException(400, "The settlement date is in the past.")
    category = db.scalars(select(Category).where(Category.kind == "ADVANCE", Category.is_active)).first()
    if not category:
        raise HTTPException(400, "Cash advances are not set up yet. Ask the Administrator.")
    claim = Claim(employee_id=user.id, type=ClaimType.ADVANCE, status=ClaimStatus.DRAFT, title=data.purpose,
                  expected_settlement_date=data.expected_settlement_date, total_claimed=data.amount)
    claim.lines.append(ClaimLine(category_id=category.id, expense_date=today(), amount=data.amount,
                                 description=data.purpose, status=LineStatus.DRAFT))
    db.add(claim)
    db.flush()
    claim.claim_no = f"ADV-{claim.id:06d}"
    return submit(db, user, claim.id)


def resubmit_advance(db: Session, user: User, claim_id: int, data: AdvanceIn) -> Claim:
    claim = _own_editable(db, user, claim_id)
    if claim.type != ClaimType.ADVANCE:
        raise HTTPException(400, "This is not a cash advance.")
    max_amount = Decimal(str(settings_service.get(db, "advance_max_amount")))
    if data.amount > max_amount:
        raise HTTPException(400, f"The most you can request is ₹{max_amount:,.2f}.")
    claim.title = data.purpose
    claim.expected_settlement_date = data.expected_settlement_date
    claim.lines[0].amount = data.amount
    claim.lines[0].description = data.purpose
    claim.total_claimed = data.amount
    return submit(db, user, claim.id)


def withdraw(db: Session, user: User, claim_id: int) -> Claim:
    """The employee pulls back a claim still in approval; it comes back to them as Withdrawn to edit and resubmit."""
    claim = db.get(Claim, claim_id)
    if not claim or claim.employee_id != user.id:
        raise HTTPException(404, "Claim not found.")
    if claim.status not in (ClaimStatus.PENDING_APPROVAL, ClaimStatus.PENDING_FINANCE):
        raise HTTPException(400, "Only a claim still being approved can be withdrawn.")
    for s in claim.steps:
        if s.status == StepStatus.PENDING:
            s.status = StepStatus.CANCELLED
            s.comment = "Withdrawn by the employee"
    for line in claim.lines:
        line.status = LineStatus.DRAFT
        line.approved_amount = None
    claim.status = ClaimStatus.WITHDRAWN
    claim.total_approved = None
    claim.return_reason = None
    audit_service.log(db, user.id, "WITHDRAWN", "claim", claim.id, claim_id=claim.id, amount=claim.total_claimed)
    db.commit()
    return claim


def company_gstin_for(db: Session, state: str) -> str | None:
    return (settings_service.get(db, "company_gstins") or {}).get(state)
