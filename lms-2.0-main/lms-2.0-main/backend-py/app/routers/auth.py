"""Thin routes only — mirrors backend/src/routes/auth.routes.js +
controllers/auth.controller.js. All business logic lives in
app/services/auth_service.py; all Entra/JWT mechanics live in app/core/.

TT Suite: the web sign-in (Entra OIDC redirect/callback, the LMS session cookie and the
browser dev-login) is gone — the portal signs people in and sets the suite session
cookie (see app/core/deps.py). What remains:
- the mobile app's bearer flow (POST /mobile/token, POST /dev-login, POST /signout);
- POST /dev/sign-in, a dev/test-only stand-in for the portal that opens a real suite
  session for an existing employee (refused in production).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from suite_core.cookies import session_cookie

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user
from app.core.entra import exchange_code_for_id_token, verify_entra_id_token
from app.core.exceptions import AppError
from app.core.responses import ok
from app.dao import employee_dao
from app.schemas.auth import DevSignInIn, MobileTokenIn, SignOutOut, TokenOut
from app.services import auth_service

router = APIRouter()


@router.post("/dev/sign-in")
def dev_suite_sign_in(payload: DevSignInIn, db: Session = Depends(get_db)):
    """DEV/TEST ONLY: never reachable in production, whatever the request says."""
    if settings.is_production:
        raise AppError("NOT_FOUND", "Not found.", status=404)
    if not (payload.email or payload.employee_code):
        raise AppError("VALIDATION_ERROR", "Give an email or an employee code.")
    employee, token = auth_service.dev_suite_sign_in(db, email=payload.email, employee_code=payload.employee_code)
    response = ok({"signed_in": True, "employee_id": employee.employee_id, "suite_user_id": employee.suite_user_id})
    response.headers.append("set-cookie", session_cookie(settings.app_profile, token))
    return response


@router.post("/dev-login")
def dev_login_json(db: Session = Depends(get_db)):
    """Mobile-only JSON dev login (bearer token) — same server-side guard as before,
    never reachable in production regardless of client input. Sets no cookie."""
    if settings.is_production or not settings.dev_auth_bypass_enabled:
        raise AppError("NOT_FOUND", "Not found.", status=404)
    employee = employee_dao.find_by_employee_code(db, settings.dev_auth_bypass_employee_code)
    if employee is None:
        raise AppError("DEV_BYPASS_MISCONFIGURED", "Dev auth bypass employee code not found.", status=401)
    token, expires_in = auth_service.sign_in(db, employee)
    return ok(TokenOut(access_token=token, expires_in=expires_in).model_dump())


@router.post("/mobile/token")
def mobile_token_exchange(payload: MobileTokenIn, db: Session = Depends(get_db)):
    """PKCE exchange for the Expo app's public client — see MIGRATION_PLAN.md §2.
    The backend does the /token exchange server-side; the phone never sees a secret."""
    id_token = exchange_code_for_id_token(
        tenant_id=settings.entra_tenant_id,
        client_id=settings.entra_mobile_client_id,
        redirect_uri=settings.entra_mobile_redirect_uri,
        code=payload.code,
        code_verifier=payload.code_verifier,
    )
    claims = verify_entra_id_token(id_token, tenant_id=settings.entra_tenant_id, audience=settings.entra_mobile_client_id)
    employee = auth_service.resolve_employee_from_entra_claims(db, claims)
    token, expires_in = auth_service.sign_in(db, employee)
    return ok(TokenOut(access_token=token, expires_in=expires_in).model_dump())


@router.post("/signout")
def sign_out(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    """Mobile sign-out (audit only; the app discards its bearer token). Web sign-out is
    the portal's POST /api/auth/logout."""
    auth_service.sign_out(db, user.employee_id if user else None)
    return ok(SignOutOut().model_dump(by_alias=True))
