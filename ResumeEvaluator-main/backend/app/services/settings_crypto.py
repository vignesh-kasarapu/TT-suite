"""Fernet encryption for sensitive system settings stored in the database.

Set SETTINGS_ENCRYPTION_KEY in the backend .env to a Fernet-generated key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

If SETTINGS_ENCRYPTION_KEY is not set the module falls back to PAN_ENCRYPTION_KEY.
If neither is set, writing sensitive settings raises RuntimeError.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_SENSITIVE_KEYS = frozenset({"imap_password", "graph_client_secret", "ldap_bind_password"})

_fernet = None
_init_done = False


def _get_fernet():
    global _fernet, _init_done
    if _init_done:
        return _fernet
    _init_done = True
    key = (
        os.environ.get("SETTINGS_ENCRYPTION_KEY", "").strip()
        or os.environ.get("PAN_ENCRYPTION_KEY", "").strip()
    )
    if not key:
        _fernet = None
        return None
    try:
        from cryptography.fernet import Fernet
        _fernet = Fernet(key.encode())
        logger.info("Settings encryption enabled (Fernet/AES-256)")
    except Exception as exc:
        logger.error("Failed to initialise settings encryption: %s", exc)
        _fernet = None
    return _fernet


def is_sensitive(setting_key: str) -> bool:
    return setting_key in _SENSITIVE_KEYS


def encrypt_setting(setting_key: str, value: str) -> str:
    """Encrypt a sensitive setting value before writing to DB. Raises if key unavailable."""
    if not is_sensitive(setting_key):
        return value
    f = _get_fernet()
    if f is None:
        raise RuntimeError(
            f"Cannot store '{setting_key}': SETTINGS_ENCRYPTION_KEY (or PAN_ENCRYPTION_KEY) "
            "is not configured. Set the env var before saving credentials."
        )
    return f.encrypt(value.encode()).decode()


def decrypt_setting(setting_key: str, stored: Optional[str]) -> Optional[str]:
    """Decrypt a sensitive setting value read from DB. Returns raw value on legacy plaintext."""
    if not stored or not is_sensitive(setting_key):
        return stored
    f = _get_fernet()
    if f is None:
        return stored
    try:
        return f.decrypt(stored.encode()).decode()
    except Exception:
        # Legacy plaintext row — return as-is
        return stored
