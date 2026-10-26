"""Approval routing (Sections 2 and 3 of the FRD).

Each line routes on its own: Level 1 is the employee's reporting manager, then Level 2 when the amount approved at Level 1 is above the
company-wide Level 2 amount (Admin > Settings > Approvals). When every line is decided, one FINANCE step is created for the claim.
"""
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import now, today
from app.models import ApprovalStep, Claim, ClaimLine, User
from app.models.enums import ClaimStatus, Level, LineStatus, PolicyAction, Role, StepStatus, can_self_serve
from app.services import audit_service, delegation_service, notification_service, settings_service

LEVEL_NAMES = {Level.L1: "Level 1", Level.L2: "Level 2", Level.FINANCE: "Finance"}


# ---------- rule helpers ----------

def l2_rules_snapshot(db: Session) -> list[dict]:
    """The Level 2 rule as it is at submit time (FR-2.10). Kept as a list so older claims still read the same way."""
    approver = settings_service.get(db, "level2_approver_id") or settings_service.get(db, "fallback_approver_id")
    if not approver:
        return []
    return [{"min": str(settings_service.get(db, "level2_above")), "max": None, "approver_id": approver}]


def find_l2(rules: list[dict], amount: Decimal) -> int | None:
    for r in rules:
        if amount > Decimal(r["min"]) and (r["max"] is None or amount <= Decimal(r["max"])):
            return r["approver_id"]
    return None


def _avoid_self(approver_id: int | None, employee: User) -> int | None:
    """FR-2.9: if the approver is the submitter (and self-approval does not apply), use their manager."""
    return employee.manager_id if approver_id == employee.id else approver_id


def _manager_who_approves(employee: User) -> int | None:
    """Level 1 is the reporting manager, if they are an active Manager. Otherwise None, so the fallback approver
    is used (an Admin never approves)."""
    m = employee.manager
    return m.id if m and m.is_active and Role.APPROVER in m.roles else None


def self_approval_eligible(db: Session, claim: Claim) -> bool:
    """FR-3.2/3.3/3.6/3.7: Manager or Admin, under the cap, no Block/Flag, no duplicate.
    Finance still checks every self-approved claim."""
    emp = claim.employee
    if not can_self_serve(emp.roles):
        return False
    cap = settings_service.get(db, "self_approval_cap")
    if cap is not None and claim.total_claimed > Decimal(str(cap)):
        return False
    for line in claim.lines:
        if line.duplicate_flags:
            return False
        if any(f["action"] in (PolicyAction.BLOCK, PolicyAction.FLAG) for f in line.policy_flags):
            return False
    return True


def payment_month(db: Session) -> str:
    """FR-6.13: approved after the cut-off day -> next month's payroll."""
    d = today()
    if d.day > int(settings_service.get(db, "payroll_cutoff_day")):
        d = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
    return d.strftime("%Y-%m")


# ---------- step creation ----------

def _new_step(db: Session, claim: Claim, line: ClaimLine | None, level: str, approver_id: int | None,
              amount: Decimal | None, status: str = StepStatus.PENDING, **extra) -> ApprovalStep:
    if approver_id is None and level != Level.FINANCE and status == StepStatus.PENDING:
        fallback = settings_service.get(db, "fallback_approver_id")  # no manager / approver found
        if fallback and fallback != claim.employee_id:
            approver_id = fallback
    step = ApprovalStep(claim=claim, line=line, round=claim.round, level=level, approver_id=approver_id,
                        amount=amount, status=status, activated_at=now(), **extra)
    db.add(step)
    if status == StepStatus.PENDING:
        _announce(db, step, claim)
    return step


def _announce(db: Session, step: ApprovalStep, claim: Claim) -> None:
    link = f"/claims/{claim.id}"
    if step.approver_id is None and step.level != Level.FINANCE:
        notification_service.notify_admins(
            db, f"{claim.claim_no}: no {LEVEL_NAMES[step.level]} approver found and no fallback approver is set. "
                "Fix the approver setup, then reassign.", link)
        return
    if step.approver_id is None:
        return  # finance pool is announced in _create_finance_step
    who = delegation_service.effective_approver_id(db, step, claim)
    notification_service.notify(
        db, who, f"{claim.claim_no} from {claim.employee.full_name} is waiting for your {LEVEL_NAMES[step.level]} approval.", link)


def _self_approve(db: Session, claim: Claim, line: ClaimLine, level: str, amount: Decimal) -> None:
    _new_step(db, claim, line, level, claim.employee_id, amount, StepStatus.APPROVED, approved_amount=amount,
              acted_by_id=claim.employee_id, acted_at=now(), self_approved=True, comment="Self-approved")
    line.approved_amount = amount
    audit_service.log(db, claim.employee_id, "SELF_APPROVED", "claim_line", line.id, claim_id=claim.id,
                      level=level, amount=amount, self_approved=True)


# ---------- flow ----------

def start(db: Session, claim: Claim) -> None:
    """Called on submit (and resubmit, which restarts from Level 1 - FR-2.6)."""
    emp = claim.employee
    claim.self_approved = self_approval_eligible(db, claim)
    for line in claim.lines:
        line.status = LineStatus.PENDING
        line.approved_amount = None
        line.reject_reason = None
        line.l1_approver_id = _manager_who_approves(emp)
        line.l2_rules = l2_rules_snapshot(db)  # FR-2.10
        db.flush()

        if claim.self_approved:
            _self_approve(db, claim, line, Level.L1, line.amount)
            after_l1(db, claim, line, line.amount)
            continue

        l1 = _avoid_self(line.l1_approver_id, emp)
        l2 = find_l2(line.l2_rules, line.amount)
        l2 = _avoid_self(l2, emp) if l2 else None
        if l2 and l1 == l2:  # Assumption: same person acts once, at Level 2
            _new_step(db, claim, line, Level.L1, l1, line.amount, StepStatus.SKIPPED,
                      comment="Same person approves at Level 2")
            _new_step(db, claim, line, Level.L2, l2, line.amount)
        else:
            _new_step(db, claim, line, Level.L1, l1, line.amount)
    progress(db, claim)


def after_l1(db: Session, claim: Claim, line: ClaimLine, amount: Decimal) -> None:
    """FR-2.5: Level 2 checks the amount approved at Level 1."""
    l2 = find_l2(line.l2_rules, amount)
    if not l2:
        line.status = LineStatus.APPROVED
        return
    if claim.self_approved and l2 == claim.employee_id:  # FR-3.3
        _self_approve(db, claim, line, Level.L2, amount)
        line.status = LineStatus.APPROVED
        return
    _new_step(db, claim, line, Level.L2, _avoid_self(l2, claim.employee), amount)


def progress(db: Session, claim: Claim) -> None:
    """FR-2.4: move to Finance only when every line is decided."""
    if any(l.status == LineStatus.PENDING for l in claim.lines):
        claim.status = ClaimStatus.PENDING_APPROVAL
        return
    approved = [l for l in claim.lines if l.status == LineStatus.APPROVED]
    if not approved:
        claim.status = ClaimStatus.REJECTED
        claim.return_reason = "All lines were rejected."
        notification_service.notify(db, claim.employee_id, f"{claim.claim_no} was rejected.", f"/claims/{claim.id}", "RETURNED")
        return
    claim.total_approved = sum((l.approved_amount for l in approved), Decimal(0))
    claim.status = ClaimStatus.PENDING_FINANCE
    _create_finance_step(db, claim)


def _create_finance_step(db: Session, claim: Claim) -> None:
    emp = claim.employee
    link = f"/claims/{claim.id}"
    assigned = None
    if Role.FINANCE in emp.roles:  # FR-3.9
        backup = settings_service.get(db, "finance_backup_reviewer_id")
        second = settings_service.get(db, "finance_second_reviewer_id")
        assigned = second if emp.id == backup else backup
        if not assigned or assigned == emp.id:
            assigned = None
            notification_service.notify_admins(
                db, f"{claim.claim_no} from a Finance Reviewer needs a Finance Backup Reviewer. "
                    "Set one in Settings, then reassign the finance step.", link)
    step = _new_step(db, claim, None, Level.FINANCE, assigned, claim.total_approved)
    if assigned is None and Role.FINANCE not in emp.roles:
        others = db.scalars(select(User.id).where(User.is_active, User.roles.contains([Role.FINANCE]), User.id != emp.id)).all()
        if not others:  # FR-3.11
            notification_service.notify_admins(db, f"{claim.claim_no} is waiting: no Finance Reviewer is available. Assign one.", link)
        else:
            tag = " (self-approved)" if claim.self_approved else ""
            notification_service.notify_role(db, Role.FINANCE, f"{claim.claim_no}{tag} is ready for the finance check.", link, exclude=emp.id)
    return step
