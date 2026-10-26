from pydantic import BaseModel

from app.schemas.base import CamelOut


class DevSignInIn(BaseModel):
    """POST /api/auth/dev/sign-in (dev/test only) — one of the two identifies the employee."""

    email: str | None = None
    employee_code: str | None = None


class MobileTokenIn(BaseModel):
    code: str
    code_verifier: str


class TokenOut(BaseModel):
    """Mobile-only endpoint with no Node precedent (backend-py added
    POST /api/auth/mobile/token new for the Expo app) — snake_case is fine,
    the mobile client (mobile/src/api/auth.ts) already expects it."""

    access_token: str
    expires_in: int


class SignOutOut(CamelOut):
    signed_out: bool = True
