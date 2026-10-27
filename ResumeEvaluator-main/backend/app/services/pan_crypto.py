"""AES-256 (Fernet) encryption for PAN card numbers stored in the database.

Set PAN_ENCRYPTION_KEY in the backend .env to a Fernet-generated key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

PAN_ENCRYPTION_KEY is required when any PAN value is written. The application
will raise at encrypt time if the key is absent.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_fernet = None
_init_done = False


def _get_fernet():
    global _fernet, _init_done
    if _init_done:
        return _fernet
    _init_done = True
    key = os.environ.get("PAN_ENCRYPTION_KEY", "").strip()
    if not key:
        _fernet = None
        return None
    try:
        from cryptography.fernet import Fernet
        _fernet = Fernet(key.encode())
        logger.info("PAN encryption enabled (Fernet/AES-256)")
    except Exception as exc:
        logger.error("Failed to initialise PAN encryption: %s", exc)
        _fernet = None
    return _fernet


def encrypt_pan(pan: Optional[str]) -> Optional[str]:
    """Return encrypted PAN for DB storage. Raises if PAN_ENCRYPTION_KEY is not configured."""
    if not pan:
        return pan
    f = _get_fernet()
    if f is None:
        raise RuntimeError(
            "PAN_ENCRYPTION_KEY is not set. "
            "Set PAN_ENCRYPTION_KEY to a Fernet key before storing PAN card numbers. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return f.encrypt(pan.encode()).decode()


def decrypt_pan(stored: Optional[str]) -> Optional[str]:
    """Return decrypted PAN for display/comparison."""
    if not stored:
        return stored
    f = _get_fernet()
    if f is None:
        # Key not configured — value may be legacy plaintext; return as-is
        return stored
    try:
        return f.decrypt(stored.encode()).decode()
    except Exception:
        # Value may be legacy plaintext row written before encryption was enabled
        return stored
