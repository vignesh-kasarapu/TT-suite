from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session, object_session
from suite_core.constants import SESSION_HOURS_DEFAULT
from suite_core.cookies import hash_session_id, new_session_token, session_cookie

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import current_user
from app.models import User
from app.models.enums import can_self_serve
from app.schemas.user import BankIn, DevSignInIn, MeOut, NotifyPrefsIn
from app.services import profile_service, settings_service, suite_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def me_out(user: User) -> MeOut:
    out = MeOut.model_validate(user)
    out.can_request_advance = can_self_serve(user.roles)
    out.manager_name = user.manager.full_name if user.manager else None
    out.bank_account_no_masked = f"•••• {user.bank_account_no[-4:]}" if user.bank_account_no else ""
    out.bank_change_pending = bool(user.bank_pending)
    out.is_level2_approver = settings_service.get(object_session(user), "level2_approver_id") == user.id
    return out


@router.post("/dev/sign-in", response_model=MeOut)
def dev_sign_in(data: DevSignInIn, response: Response, db: Session = Depends(get_db)):
    """Development and tests only (refused when APP_PROFILE=prod): sign in as an EMS user without Microsoft.
    Activates the suite person, mirrors their EMS role, opens a suite session and sets the suite cookie.
    Real sign-in is the portal's /login."""
    if settings.is_prod:
        raise HTTPException(404, "Not found.")
    user = suite_service.find_local(db, email=str(data.email))
    if not user or not user.is_active:
        raise HTTPException(404, "No active Expense user has that email.")
    uid = suite_service.mirror(db, user)
    db.execute(text("UPDATE app.users SET status = 'active', last_login_at = now() WHERE id = :u"), {"u": uid})
    token = new_session_token()
    db.execute(text("INSERT INTO app.session (id, user_id, expires_at) VALUES (:id, :u, :e)"),
               {"id": hash_session_id(token), "u": uid, "e": datetime.now(UTC) + timedelta(hours=SESSION_HOURS_DEFAULT)})
    db.commit()
    response.headers.append("set-cookie", session_cookie(settings.app_profile, token))
    return me_out(user)


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(current_user)):
    return me_out(user)


@router.put("/me/bank", response_model=MeOut)
def change_bank(data: BankIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_out(profile_service.request_bank_change(db, user, data))


@router.put("/me/notifications", response_model=MeOut)
def save_notify_prefs(data: NotifyPrefsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return me_out(profile_service.save_notify_prefs(db, user, data.prefs))
