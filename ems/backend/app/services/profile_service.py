"""The employee's own profile: bank details (verified by Finance), notification choices.
Name, theme and sign-out belong to the TT Suite portal (/profile, /signout)."""
import re

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.time import now
from app.models import User
from app.models.enums import Role
from app.schemas.user import BankIn
from app.services import audit_service, notification_service, settings_service

IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
BANK_FIELDS = ("bank_account_holder", "bank_account_no", "bank_ifsc", "bank_upi")


def request_bank_change(db: Session, user: User, data: BankIn) -> User:
    ifsc = data.ifsc.strip().upper()
    account = re.sub(r"\s", "", data.account_no)
    if not IFSC_RE.match(ifsc):
        raise HTTPException(400, "The IFSC code should look like HDFC0001234.")
    if not account.isdigit() or not 6 <= len(account) <= 20:
        raise HTTPException(400, "The account number should be 6 to 20 digits.")
    new = {"bank_account_holder": data.account_holder.strip(), "bank_account_no": account,
           "bank_ifsc": ifsc, "bank_upi": data.upi.strip()}
    user = db.merge(user)
    if settings_service.get(db, "bank_change_needs_verification"):
        user.bank_pending = {**new, "requested_at": now().isoformat()}
        audit_service.log(db, user.id, "BANK_CHANGE_REQUESTED", "user", user.id)
        notification_service.notify_role(db, Role.FINANCE, f"{user.full_name} changed their bank details. Please verify.",
                                         "/finance/bank-changes", exclude=user.id)
    else:
        for k, v in new.items():
            setattr(user, k, v)
        audit_service.log(db, user.id, "BANK_DETAILS_CHANGED", "user", user.id)
    db.commit()
    return user


def pending_bank_changes(db: Session) -> list[User]:
    # jsonb_typeof skips rows cleared before none_as_null, which hold a JSON null rather than SQL NULL
    pending = func.jsonb_typeof(User.bank_pending) == "object"
    return list(db.scalars(select(User).where(pending).order_by(User.full_name)))


def decide_bank_change(db: Session, reviewer: User, user_id: int, approve: bool, reason: str = "") -> User:
    user = db.get(User, user_id)
    if not user or not user.bank_pending:
        raise HTTPException(404, "No pending bank change for this person.")
    if user.id == reviewer.id:
        raise HTTPException(403, "Another Finance Reviewer must verify your own bank details.")
    if approve:
        for k in BANK_FIELDS:
            setattr(user, k, user.bank_pending.get(k, ""))
        msg = "Your new bank details were verified and will be used for the next payout."
    else:
        if not reason.strip():
            raise HTTPException(400, "Give a reason for rejecting the change.")
        msg = f"Your bank detail change was not accepted: {reason}"
    audit_service.log(db, reviewer.id, "BANK_CHANGE_VERIFIED" if approve else "BANK_CHANGE_REJECTED", "user", user.id,
                      details={"reason": reason} if reason else {})
    user.bank_pending = None
    notification_service.notify(db, user.id, msg, "/profile")
    db.commit()
    return user


def save_notify_prefs(db: Session, user: User, prefs: dict[str, bool]) -> User:
    user = db.merge(user)
    user.notify_prefs = {k: bool(v) for k, v in prefs.items() if k in notification_service.OPTIONAL_KINDS}
    db.commit()
    return user
