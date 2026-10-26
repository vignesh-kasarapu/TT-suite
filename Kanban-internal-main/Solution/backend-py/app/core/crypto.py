"""AES-256-GCM with APP_SECRET (D-075): Teams webhook URLs at rest and the OIDC flight cookie.

Blob layout is `iv(12) | tag(16) | ciphertext`, as stored by the previous backend. The
`cryptography` library wants `ciphertext | tag`, so the parts are reordered on the way in and
out; existing rows and cookies keep decrypting.
"""

import base64
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.exceptions.custom_exceptions import NotConfiguredException

IV_LEN = 12
TAG_LEN = 16


def _key(app_secret: str) -> bytes:
    try:
        k = base64.b64decode(app_secret, validate=False) if app_secret else b""
    except ValueError:
        k = b""
    if len(k) != 32:
        raise NotConfiguredException(
            "APP_SECRET (32 bytes, base64) is not set; Teams webhooks are off."
        )
    return k


def encrypt(app_secret: str, plaintext: str) -> bytes:
    iv = secrets.token_bytes(IV_LEN)
    sealed = AESGCM(_key(app_secret)).encrypt(iv, plaintext.encode("utf-8"), None)
    ct, tag = sealed[:-TAG_LEN], sealed[-TAG_LEN:]
    return iv + tag + ct


def decrypt(app_secret: str, blob: bytes) -> str:
    iv, tag, ct = blob[:IV_LEN], blob[IV_LEN : IV_LEN + TAG_LEN], blob[IV_LEN + TAG_LEN :]
    return AESGCM(_key(app_secret)).decrypt(iv, ct + tag, None).decode("utf-8")
