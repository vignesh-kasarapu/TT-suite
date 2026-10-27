from fastapi import APIRouter, Depends

from app.auth.schemas import AuthUserResponse
from app.common.exceptions import ErrorResponse
from app.common.security import get_current_user
from app.users.models import User

# TT Suite: no /auth/login or /auth/change-password. People sign in (and out) once, in the portal;
# its session cookie is read on every request (app/common/security.py). No PUT /auth/me either:
# names are edited in the portal profile and synced on every request.
router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.get(
    "/me",
    response_model=AuthUserResponse,
    responses={
        401: {"model": ErrorResponse, "description": "Not signed in to the TT Suite"},
        403: {"model": ErrorResponse, "description": "No Asset Management access (code NO_APP_ACCESS)"},
    },
    summary="Get current authenticated user profile",
)
def get_me(current_user: User = Depends(get_current_user)) -> AuthUserResponse:
    return AuthUserResponse.model_validate(current_user)
