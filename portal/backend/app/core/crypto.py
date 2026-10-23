"""AES-256-GCM with APP_SECRET for the OIDC in-flight cookie (Kanban D-075, same blob layout:
`iv(12) | tag(16) | ciphertext`, base64url)."""

import base64
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.errors import AppError

IV_LEN = 12
TAG_LEN = 16


def _key(app_secret: str) -> bytes:
    try:
        k = base64.b64decode(app_secret, validate=False) if app_secret else b""
    except ValueError:
        k = b""
    if len(k) != 32:
        raise AppError(503, "NOT_CONFIGURED", "APP_SECRET (32 bytes, base64) is not set.")
    return k


def seal(app_secret: str, plaintext: str) -> str:
    iv = secrets.token_bytes(IV_LEN)
    sealed = AESGCM(_key(app_secret)).encrypt(iv, plaintext.encode("utf-8"), None)
    blob = iv + sealed[-TAG_LEN:] + sealed[:-TAG_LEN]
    return base64.urlsafe_b64encode(blob).rstrip(b"=").decode("ascii")


def unseal(app_secret: str, value: str) -> str:
    blob = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    iv, tag, ct = blob[:IV_LEN], blob[IV_LEN : IV_LEN + TAG_LEN], blob[IV_LEN + TAG_LEN :]
    return AESGCM(_key(app_secret)).decrypt(iv, ct + tag, None).decode("utf-8")
