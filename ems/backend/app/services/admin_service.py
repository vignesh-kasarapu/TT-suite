"""Administrator configuration (FR-4.x, FR-5.x). Every change is audited with old and new values (FR-4.7)."""
import csv
import io
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.time import now
from app.models import ApprovalStep, AuditLog, Category, ClaimLine, Delegation, PolicyLimit, User
from app.models.enums import Level, Role, StepStatus, role_conflict
from app.schemas.admin import CategoryIn, LimitIn, ReassignIn
from app.schemas.user import UserIn
from app.services import audit_service, notification_service, settings_service, suite_service

USER_FIELDS = ("email", "full_name", "employee_code", "department", "location", "manager_id", "phone",
               "designation", "roles", "is_active")


def _snapshot(obj, fields) -> dict:
    return {f: getattr(obj, f) for f in fields}


def _commit(db: Session, what: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, f"That {what} already exists or is still in use.")


# ---------- users ----------

def list_users(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.full_name)))


def save_user(db: Session, actor: User | None, data: UserIn, user_id: int | None = None, *, source: str = "app",
              suite_actor: str | None = None, entra_oid: str | None = None) -> User:
    """Create or update a user and mirror their effective role into the TT Suite in the same transaction.
    `actor` is the EMS admin (None when the portal provisions); `suite_actor` is the suite id of whoever made the change."""
    actor_id = actor.id if actor else None
    if problem := role_conflict(data.roles):
        raise HTTPException(400, problem)
    if data.manager_id and not _is_manager(db.get(User, data.manager_id)):
        raise HTTPException(400, "The reporting manager must hold the Manager role.")
    if user_id:
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(404, "User not found.")
        old = _snapshot(user, USER_FIELDS)
    else:
        user = User()
        db.add(user)
        old = None
    if data.manager_id and user_id and data.manager_id == user_id:
        raise HTTPException(400, "A person cannot be their own manager.")
    was_active = user.is_active if user_id else True
    for f in USER_FIELDS:
        setattr(user, f, getattr(data, f))
    user.email = user.email.lower()
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "That email or employee code already exists.")
    audit_service.log(db, actor_id, "USER_UPDATED" if old else "USER_CREATED", "user", user.id,
                      details={"old": old, "new": _snapshot(user, USER_FIELDS)})
    if was_active and not user.is_active:
        _handle_leaver(db, actor_id, user)
    suite_service.mirror(db, user, source=source, actor=suite_actor or (actor.suite_user_id if actor else None),
                         entra_oid=entra_oid, old_email=old["email"] if old else None)
    _commit(db, "email or employee code")
    return user


def _handle_leaver(db: Session, actor_id: int | None, user: User) -> None:
    """FR-4.2: pending approvals move to the leaver's manager; their delegations end.
    The caller mirrors the leaver (effective role None) into the TT Suite in the same transaction."""
    steps = db.scalars(select(ApprovalStep).where(ApprovalStep.approver_id == user.id, ApprovalStep.status == StepStatus.PENDING)).all()
    for s in steps:
        s.approver_id = user.manager_id
        s.activated_at = now()
        audit_service.log(db, actor_id, "STEP_REASSIGNED", "approval_step", s.id, claim_id=s.claim_id, level=s.level,
                          details={"from": user.full_name, "reason": "leaver"})
        notification_service.notify(db, user.manager_id, f"{s.claim.claim_no} moved to you because {user.full_name} left.",
                                    f"/claims/{s.claim_id}")
    for d in db.scalars(select(Delegation).where(Delegation.delegator_id == user.id, Delegation.cancelled_at.is_(None))):
        d.cancelled_at = now()


def _is_manager(user: User | None) -> bool:
    return bool(user and user.is_active and Role.APPROVER in user.roles)


# ---------- categories ----------

def list_categories(db: Session, only_active: bool = False) -> list[Category]:
    q = select(Category).order_by(Category.kind, Category.name)
    if only_active:
        q = q.where(Category.is_active)
    return list(db.scalars(q))


def save_category(db: Session, actor: User, data: CategoryIn, category_id: int | None = None) -> Category:
    if category_id:
        cat = db.get(Category, category_id)
        if not cat:
            raise HTTPException(404, "Category not found.")
        old = _category_snapshot(cat)
    else:
        cat = Category()
        db.add(cat)
        old = None
    for f in CategoryIn.model_fields:
        setattr(cat, f, getattr(data, f))
    db.flush()
    audit_service.log(db, actor.id, "CATEGORY_SAVED", "category", cat.id, details={"old": old, "new": _category_snapshot(cat)})
    _commit(db, "category name")
    return cat


def _category_snapshot(cat: Category) -> dict:
    return {
        **{f: getattr(cat, f) for f in CategoryIn.model_fields},
    }


def delete_category(db: Session, actor: User, category_id: int) -> None:
    """FR-5.2: used categories cannot be deleted, only deactivated."""
    cat = db.get(Category, category_id)
    if not cat:
        raise HTTPException(404, "Category not found.")
    if db.scalars(select(ClaimLine.id).where(ClaimLine.category_id == cat.id).limit(1)).first():
        raise HTTPException(400, "This category is used on claims. Deactivate it instead.")
    if db.scalars(select(PolicyLimit.id).where(PolicyLimit.category_id == cat.id).limit(1)).first():
        raise HTTPException(400, "Remove this category's policy limits first.")
    audit_service.log(db, actor.id, "CATEGORY_DELETED", "category", cat.id, details={"old": _category_snapshot(cat)})
    db.delete(cat)
    db.commit()


# ---------- policy limits ----------

def list_limits(db: Session) -> list[PolicyLimit]:
    return list(db.scalars(select(PolicyLimit).order_by(PolicyLimit.category_id, PolicyLimit.scope)))


def save_limit(db: Session, actor: User, data: LimitIn, limit_id: int | None = None) -> PolicyLimit:
    if data.scope != "COMPANY" and not (data.scope_value or "").strip():
        raise HTTPException(400, "Say which employee or department this limit is for.")
    if data.effective_to and data.effective_to < data.effective_from:
        raise HTTPException(400, "The end date must be on or after the start date.")
    if limit_id:
        row = db.get(PolicyLimit, limit_id)
        if not row:
            raise HTTPException(404, "Limit not found.")
        old = _snapshot(row, LimitIn.model_fields)
    else:
        row = PolicyLimit()
        db.add(row)
        old = None
    for f in LimitIn.model_fields:
        setattr(row, f, getattr(data, f))
    if data.scope == "COMPANY":
        row.scope_value = None
    db.flush()
    audit_service.log(db, actor.id, "LIMIT_SAVED", "policy_limit", row.id, details={"old": old, "new": data.model_dump()})
    db.commit()
    return row


# ---------- settings ----------

def update_settings(db: Session, actor: User, changes: dict) -> dict:
    for key in ("finance_backup_reviewer_id", "finance_second_reviewer_id"):
        uid = changes.get(key)
        if uid is not None:
            u = db.get(User, uid)
            if not u or not u.is_active or Role.FINANCE not in u.roles:
                raise HTTPException(400, "The Finance Backup Reviewer and the second reviewer must hold the Finance Reviewer role.")
    for key, label in (("fallback_approver_id", "fallback approver"), ("level2_approver_id", "second approver")):
        uid = changes.get(key)
        if uid is not None:
            u = db.get(User, uid)
            if not _is_manager(u):
                raise HTTPException(400, f"The {label} must hold the Manager role.")
    if "level2_above" in changes and (changes["level2_above"] is None or Decimal(str(changes["level2_above"])) < 0):
        raise HTTPException(400, "Enter the amount above which the second approver must approve.")
    for key in ("projects", "cost_centres", "departments"):
        if key in changes:
            changes[key] = sorted({str(v).strip() for v in (changes[key] or []) if str(v).strip()})
    if "late_submission_days" in changes and int(changes["late_submission_days"]) < 0:
        raise HTTPException(400, "Submit-within days cannot be negative (0 = no limit).")
    backup, second = changes.get("finance_backup_reviewer_id"), changes.get("finance_second_reviewer_id")
    if backup is not None and backup == second:
        raise HTTPException(400, "The second reviewer must be a different person from the Finance Backup Reviewer.")
    cap = changes.get("self_approval_cap")
    if cap is not None and Decimal(str(cap)) <= 0:
        raise HTTPException(400, "The self-approval cap must be above zero, or empty for no cap.")
    for key in ("reminder_days", "escalation_days", "advance_settle_days", "duplicate_window_days"):
        if key in changes and int(changes[key]) < 1:
            raise HTTPException(400, "Day counts must be at least 1.")
    if "payroll_cutoff_day" in changes and not 1 <= int(changes["payroll_cutoff_day"]) <= 28:
        raise HTTPException(400, "The payroll cut-off day must be between 1 and 28.")
    return settings_service.update(db, actor.id, changes)


# ---------- stuck claims ----------

def reassign_step(db: Session, actor: User, data: ReassignIn) -> ApprovalStep:
    """Admin fixes a stuck step (no approver found, leaver, missing Finance Backup Reviewer).
    The Admin never approves; they only choose who does."""
    step = db.get(ApprovalStep, data.step_id)
    if not step or step.status != StepStatus.PENDING:
        raise HTTPException(400, "Only a pending step can be reassigned.")
    target = db.get(User, data.approver_id)
    if not target or not target.is_active:
        raise HTTPException(400, "Choose an active person.")
    if target.id == step.claim.employee_id:
        raise HTTPException(400, "The submitter cannot approve their own claim.")
    needed = Role.FINANCE if step.level == Level.FINANCE else Role.APPROVER
    if needed not in target.roles:
        raise HTTPException(400, f"{target.full_name} does not hold the {'Finance Reviewer' if needed == Role.FINANCE else 'Manager'} role.")
    old = step.approver_id
    step.approver_id = target.id
    step.activated_at = now()
    audit_service.log(db, actor.id, "STEP_REASSIGNED", "approval_step", step.id, claim_id=step.claim_id, level=step.level,
                      details={"old": old, "new": target.id})
    notification_service.notify(db, target.id, f"{step.claim.claim_no} was assigned to you.", f"/claims/{step.claim_id}")
    db.commit()
    return step


# ---------- CSV import and "last change" ----------

CSV_COLUMNS = ("email", "full_name", "employee_code", "department", "location", "manager_email", "roles",
               "phone", "designation")


def import_users(db: Session, actor: User, content: bytes) -> dict:
    """Columns: email, full_name, employee_code, department, location, manager_email, roles (APPROVER;FINANCE),
    phone, designation. Existing users are matched by email and updated. People sign in through the TT Suite,
    so there are no passwords; every added or updated person is mirrored into app.app_access."""
    try:
        rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"))))
    except UnicodeDecodeError:
        raise HTTPException(400, "Save the file as CSV (UTF-8) and try again.")
    if not rows or "email" not in rows[0]:
        raise HTTPException(400, f"The first row must be the column names: {', '.join(CSV_COLUMNS)}.")
    created = updated = 0
    errors: list[str] = []
    touched: list[User] = []
    by_email: dict[str, User] = {u.email: u for u in db.scalars(select(User))}
    pending_managers: list[tuple[User, str, int]] = []
    for n, r in enumerate(rows, start=2):
        email = (r.get("email") or "").strip().lower()
        name = (r.get("full_name") or "").strip()
        code = (r.get("employee_code") or "").strip()
        if not email or not name or not code:
            errors.append(f"Row {n}: email, full_name and employee_code are required.")
            continue
        roles = [x.strip().upper() for x in (r.get("roles") or "").replace(",", ";").split(";") if x.strip()]
        if any(x not in Role.ALL for x in roles):
            errors.append(f"Row {n}: roles must be APPROVER (Manager), FINANCE or ADMIN.")
            continue
        if problem := role_conflict(roles):
            errors.append(f"Row {n}: {problem}")
            continue
        user = by_email.get(email)
        if not user:
            user = User(email=email, is_active=True)
            db.add(user)
            by_email[email] = user
            created += 1
        else:
            updated += 1
        touched.append(user)
        user.full_name, user.employee_code, user.roles = name, code, roles
        for f in ("department", "location", "phone", "designation"):
            setattr(user, f, (r.get(f) or "").strip())
        if (r.get("manager_email") or "").strip():
            pending_managers.append((user, r["manager_email"].strip().lower(), n))
    for user, mgr_email, n in pending_managers:
        mgr = by_email.get(mgr_email)
        if not mgr or mgr is user:
            errors.append(f"Row {n}: manager {mgr_email} not found.")
        elif Role.APPROVER not in mgr.roles:
            errors.append(f"Row {n}: manager {mgr_email} does not hold the Manager role.")
        else:
            user.manager = mgr
    for user in touched:
        suite_service.mirror(db, user, actor=actor.suite_user_id)
    audit_service.log(db, actor.id, "USERS_IMPORTED", "user", "", details={"created": created, "updated": updated})
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Two users share an email or employee code. Fix the file and try again.")
    return {"created": created, "updated": updated, "errors": errors}


CONFIG_ENTITIES = ("user", "category", "policy_limit", "setting")


def last_change(db: Session, entity: str | None = None) -> dict | None:
    q = select(AuditLog).where(AuditLog.entity.in_((entity,) if entity else CONFIG_ENTITIES)).order_by(AuditLog.at.desc()).limit(1)
    row = db.scalars(q).first()
    if not row:
        return None
    what = row.action.replace("_", " ").lower()
    if row.entity == "setting":
        what = f"changed {row.entity_id.replace('_', ' ')}"
    return {"who": row.actor.full_name if row.actor else "System", "what": what, "at": row.at}
