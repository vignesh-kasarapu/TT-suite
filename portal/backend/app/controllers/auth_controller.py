"""Sign-in, sign-out, and the dev picker (never in prod)."""

import logging

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.deps import auth_service, get_db, get_settings, session_cookie
from app.core.errors import AppError
from app.services.auth_service import AuthService
from suite_core.cookies import clear_flight_cookie, clear_session_cookie, flight_cookie
from suite_core.cookies import session_cookie as session_set_cookie

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger("portal")
FLIGHT_COOKIE = "tt_oidc"
FLIGHT_PATH = "/api/auth/oidc"


@router.get("/config")
async def config(settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {"provider": settings.AUTH_PROVIDER}


@router.get("/oidc/start")
async def oidc_start(returnTo: str | None = None, auth: AuthService = Depends(auth_service),  # noqa: N803
                     settings: Settings = Depends(get_settings)) -> Response:
    try:
        url, sealed = await auth.oidc_start(returnTo)
    except httpx.HTTPError as err:
        # Microsoft did not answer, or refused the tenant (a wrong ENTRA_TENANT_ID): say so in the log,
        # and give the person a plain message instead of an error page.
        log.error("Microsoft sign-in unavailable (check ENTRA_TENANT_ID and network): %s", err)
        return RedirectResponse("/login?error=OIDC_UNAVAILABLE", status_code=302)
    res = RedirectResponse(url, status_code=302)
    res.headers.append("set-cookie", flight_cookie(settings.APP_PROFILE, FLIGHT_COOKIE, sealed, FLIGHT_PATH, 600))
    return res


@router.get("/oidc/callback")
async def oidc_callback(request: Request, auth: AuthService = Depends(auth_service),
                        settings: Settings = Depends(get_settings)) -> Response:
    outcome = await auth.oidc_complete(dict(request.query_params), request.cookies.get(FLIGHT_COOKIE),
                                       request.headers.get("user-agent", ""))
    res = RedirectResponse(outcome.redirect_to, status_code=302)
    res.headers.append("set-cookie", clear_flight_cookie(settings.APP_PROFILE, FLIGHT_COOKIE, FLIGHT_PATH))
    if outcome.session_token:
        res.headers.append("set-cookie", session_set_cookie(settings.APP_PROFILE, outcome.session_token))
    return res


class SignOut(BaseModel):
    everywhere: bool = False  # True = every device this person is signed in on


@router.post("/logout")
async def logout(request: Request, body: SignOut | None = None, auth: AuthService = Depends(auth_service),
                 settings: Settings = Depends(get_settings)) -> Response:
    """Sign out of this device (the default), or of every device with {"everywhere": true}."""
    ended = await auth.sign_out(session_cookie(request), everywhere=bool(body and body.everywhere))
    res = JSONResponse({"signedOut": ended})
    res.headers.append("set-cookie", clear_session_cookie(settings.APP_PROFILE))
    return res


# ---- dev only: pick an invited person (AUTH_PROVIDER=dev, never prod)
class DevSignIn(BaseModel):
    email: str


def _dev_only(settings: Settings) -> None:
    if settings.APP_PROFILE == "prod" or settings.AUTH_PROVIDER != "dev":
        raise AppError(404, "NOT_FOUND", "Not found.")


@router.get("/dev/users")
async def dev_users(settings: Settings = Depends(get_settings), db: AsyncSession = Depends(get_db)) -> list[dict[str, object]]:
    _dev_only(settings)
    rows = await db.execute(
        text("SELECT email, name, is_global_admin FROM app.users WHERE status <> 'inactive' ORDER BY is_global_admin DESC, email")
    )
    return [{"email": r[0], "name": r[1] or r[0], "isGlobalAdmin": r[2]} for r in rows]


@router.post("/dev/sign-in", status_code=204)
async def dev_sign_in(request: Request, body: DevSignIn, auth: AuthService = Depends(auth_service),
                      settings: Settings = Depends(get_settings)) -> Response:
    _dev_only(settings)
    token = await auth.dev_sign_in(body.email, request.headers.get("user-agent", ""))
    res = Response(status_code=204)
    res.headers.append("set-cookie", session_set_cookie(settings.APP_PROFILE, token))
    return res
