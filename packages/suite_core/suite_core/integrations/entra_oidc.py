"""Entra ID OpenID Connect (D-084): auth code + PKCE against the tenant's v2.0 issuer.

Transport and token checks only: discovery, the authorize URL, the code exchange and the ID
token validation (signature from the tenant JWKS, issuer, audience, expiry, nonce).
"""

import base64
import hashlib
import secrets
from typing import Any
from urllib.parse import urlencode

import httpx
from joserfc import jwt
from joserfc.jwk import KeySet

from suite_core.integrations.settings import SuiteSettings as Settings

SCOPE = "openid profile email User.Read"


class OidcError(Exception):
    """The exchange failed; the message is safe to show as the problem detail."""


def random_token(n: int = 32) -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(n)).rstrip(b"=").decode("ascii")


def pkce_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class EntraClient:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self.settings = settings
        self.http = http
        self._meta: dict[str, Any] | None = None
        self._jwks: KeySet | None = None

    async def metadata(self) -> dict[str, Any]:
        if self._meta is None:
            url = (
                f"https://login.microsoftonline.com/{self.settings.ENTRA_TENANT_ID}"
                "/v2.0/.well-known/openid-configuration"
            )
            res = await self.http.get(url)
            res.raise_for_status()
            self._meta = res.json()
        return self._meta

    async def authorize_url(self, *, state: str, nonce: str, challenge: str) -> str:
        meta = await self.metadata()
        query = urlencode(
            {
                "client_id": self.settings.ENTRA_CLIENT_ID,
                "response_type": "code",
                "redirect_uri": self.settings.ENTRA_REDIRECT_URI,
                "scope": SCOPE,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                "state": state,
                "nonce": nonce,
            }
        )
        return f"{meta['authorization_endpoint']}?{query}"

    async def exchange(
        self, params: dict[str, str], *, state: str, nonce: str, verifier: str
    ) -> dict[str, Any] | None:
        """Callback query -> verified ID token claims (None when no ID token came back)."""
        if "error" in params:
            desc = params.get("error_description", "").split(" Trace ID")[0]
            raise OidcError(f"{params['error']}: {desc}")
        if params.get("state") != state:
            raise OidcError("unexpected state")
        code = params.get("code")
        if not code:
            raise OidcError("no authorization code")
        meta = await self.metadata()
        res = await self.http.post(
            meta["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.settings.ENTRA_REDIRECT_URI,
                "code_verifier": verifier,
                "client_id": self.settings.ENTRA_CLIENT_ID,
                "client_secret": self.settings.ENTRA_CLIENT_SECRET,
            },
        )
        body: dict[str, Any] = res.json() if res.content else {}
        if res.status_code >= 400:
            if body.get("error"):
                desc = str(body.get("error_description", "")).split(" Trace ID")[0]
                raise OidcError(f"{body['error']}: {desc}")
            raise OidcError(f"token endpoint answered {res.status_code}")
        id_token = body.get("id_token")
        if not id_token:
            return None
        return await self._verify(str(id_token), meta, nonce)

    async def _verify(self, id_token: str, meta: dict[str, Any], nonce: str) -> dict[str, Any]:
        if self._jwks is None:
            res = await self.http.get(meta["jwks_uri"])
            res.raise_for_status()
            self._jwks = KeySet.import_key_set(res.json())
        try:
            token = jwt.decode(id_token, self._jwks)
            jwt.JWTClaimsRegistry(
                leeway=30,
                iss={"essential": True, "value": meta["issuer"]},
                aud={"essential": True, "value": self.settings.ENTRA_CLIENT_ID},
                nonce={"essential": True, "value": nonce},
            ).validate(token.claims)
        except Exception as err:
            raise OidcError(f"ID token rejected ({type(err).__name__})") from err
        return dict(token.claims)
