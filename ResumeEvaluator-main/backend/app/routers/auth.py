"""Who am I. Signing in, out and passwords belong to the TT Suite portal (Microsoft sign-in);
this app has no login of its own."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends

from app.deps import get_current_user
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
def me(current_user: User = Depends(get_current_user)) -> dict:
    """The signed-in person's user here: role (recruiter | admin, given in the portal) and
    permission flags."""
    try:
        permissions = json.loads(current_user.permissions) if current_user.permissions else {}
    except (ValueError, TypeError):
        permissions = {}
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name or current_user.email,
        "role": current_user.role,
        "permissions": permissions,
    }
