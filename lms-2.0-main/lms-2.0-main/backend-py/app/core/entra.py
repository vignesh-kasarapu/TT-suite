"""Microsoft Entra ID OIDC — code exchange + JWKS id-token verification.
Mirrors backend/src/services/auth.service.js's exchangeCodeForIdToken/
verifyEntraIdToken exactly: only oid/email/name claims are ever read (LMS-001/004
— no group/role claims trusted), hand-rolled against Entra's raw endpoints (no
MSAL dependency), so the web (confidential client + secret) and mobile (public
client + PKCE code_verifier, no secret) flows share one function."""
import time

import httpx
from jose import jwt

from app.core.config import settings

_jwks_cache: dict[str, tuple[float, list[dict]]] = {}
_JWKS_TTL_SECONDS = 3600


class EntraAuthError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


def _authorize_base(tenant_id: str) -> str:
    return f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0"


def build_authorize_url(*, tenant_id: str, client_id: str, redirect_uri: str, state: str) -> str:
    params = httpx.QueryParams(
        {
            "client_id": client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "response_mode": "query",
            "scope": "openid profile email",
            "state": state,
        }
    )
    return f"{_authorize_base(tenant_id)}/authorize?{params}"


def exchange_code_for_id_token(
    *,
    tenant_id: str,
    client_id: str,
    redirect_uri: str,
    code: str,
    client_secret: str | None = None,
    code_verifier: str | None = None,
) -> str:
    data = {
        "client_id": client_id,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "scope": "openid profile email",
    }
    if client_secret:
        data["client_secret"] = client_secret
    if code_verifier:
        data["code_verifier"] = code_verifier

    resp = httpx.post(f"{_authorize_base(tenant_id)}/token", data=data, timeout=10.0)
    if resp.status_code != 200:
        raise EntraAuthError("ENTRA_TOKEN_EXCHANGE_FAILED", "Could not exchange the authorization code.")
    body = resp.json()
    id_token = body.get("id_token")
    if not id_token:
        raise EntraAuthError("ENTRA_TOKEN_MISSING_ID_TOKEN", "Entra did not return an id_token.")
    return id_token


def _get_jwks(tenant_id: str) -> list[dict]:
    cached = _jwks_cache.get(tenant_id)
    if cached and time.time() - cached[0] < _JWKS_TTL_SECONDS:
        return cached[1]
    resp = httpx.get(f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys", timeout=10.0)
    resp.raise_for_status()
    keys = resp.json()["keys"]
    _jwks_cache[tenant_id] = (time.time(), keys)
    return keys


def verify_entra_id_token(id_token: str, *, tenant_id: str, audience: str) -> dict:
    """Returns {oid, email, name}. Raises EntraAuthError on any verification failure."""
    header = jwt.get_unverified_header(id_token)
    kid = header.get("kid")
    keys = _get_jwks(tenant_id)
    jwk = next((k for k in keys if k.get("kid") == kid), None)
    if jwk is None:
        raise EntraAuthError("ENTRA_TOKEN_INVALID", "No matching signing key found for this token.")

    try:
        claims = jwt.decode(
            id_token,
            jwk,
            algorithms=["RS256"],
            audience=audience,
            issuer=f"https://login.microsoftonline.com/{tenant_id}/v2.0",
        )
    except Exception as exc:  # jose raises several JWTError subtypes; all mean "reject the token"
        raise EntraAuthError("ENTRA_TOKEN_INVALID", "Entra token failed verification.") from exc

    return {
        "oid": claims["oid"],
        "email": claims.get("preferred_username") or claims.get("email"),
        "name": claims.get("name"),
    }


def build_settings_authorize_url(state: str) -> str:
    return build_authorize_url(
        tenant_id=settings.entra_tenant_id,
        client_id=settings.entra_client_id,
        redirect_uri=settings.entra_redirect_uri,
        state=state,
    )
