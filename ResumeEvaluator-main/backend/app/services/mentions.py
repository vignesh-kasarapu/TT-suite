"""@mention parsing for candidate comments."""
from __future__ import annotations

import re
from typing import List

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import User

_MENTION_RE = re.compile(r"@([\w.+-]+@[\w.-]+\.\w+|[\w.]{2,})")


def extract_mentions(body: str) -> List[str]:
    """Return raw @-tokens (without the @) found in a comment body."""
    return _MENTION_RE.findall(body or "")


def resolve_mentions(db: Session, tokens: List[str]) -> List[User]:
    """Resolve @-tokens to User accounts by exact (case-insensitive) email match.

    Only matches against User.email — a mention of someone without a login
    account (e.g. an OrgEmployee-only contact) can't be notified in-app, so
    unresolved tokens are silently skipped rather than erroring.
    """
    if not tokens:
        return []
    emails = {t.lower() for t in tokens if "@" in t}
    if not emails:
        return []
    return db.query(User).filter(func.lower(User.email).in_(emails)).all()
