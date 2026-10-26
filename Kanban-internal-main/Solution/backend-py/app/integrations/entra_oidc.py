"""Entra ID OpenID Connect (D-084) - now the suite's shared client (TT Suite, SUITE-CONTRACT §2).

Kept as a thin re-export so `app.integrations.entra_oidc` imports keep working. Sign-in itself
moved to the portal; Kanban no longer runs the OIDC flow.
"""

from suite_core.integrations.entra_oidc import (
    SCOPE,
    EntraClient,
    OidcError,
    pkce_challenge,
    random_token,
)

__all__ = ["SCOPE", "EntraClient", "OidcError", "pkce_challenge", "random_token"]
