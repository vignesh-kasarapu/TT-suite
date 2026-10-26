"""auth: provider descriptor, contact-admin, and the dev-only fixed-identity sign-in.

TT Suite (SUITE-CONTRACT §3.1): sign-in (Entra OIDC) and sign-out are the portal's, so Kanban's
`/auth/oidc/*` and `/auth/sign-out` are gone. The dev/test sign-in (never in prod) stays for the
pytest and Playwright suites; it issues a suite session cookie.
"""

from fastapi import APIRouter, Depends, Response, status

from app.core.config import Settings
from app.core.security import session_cookie
from app.dependencies.auth import RoleRoute, roles
from app.dependencies.database import get_settings
from app.dependencies.services import get_auth_service
from app.schemas.auth_schema import AuthConfig, ContactAdminRequest, DevSignInRequest, UserRefList
from app.schemas.common_schema import problem_responses
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"], route_class=RoleRoute)
dev_router = APIRouter(prefix="/auth/dev", tags=["dev", "auth"], route_class=RoleRoute)


@router.get(
    "/config",
    operation_id="getAuthConfig",
    summary="Which identity provider is active (drives the sign-in page)",
    response_model=AuthConfig,
    openapi_extra=roles("anonymous"),
)
async def get_auth_config(service: AuthService = Depends(get_auth_service)) -> AuthConfig:
    return service.auth_config()


@router.post(
    "/contact-admin",
    operation_id="contactAdmin",
    summary="Message the admins without signing in (D-125); sent to every active admin by email",
    description="Rate-limited per IP (`RL_CONTACT_IP`, default 5 an hour). Always 204, so it "
    "never tells whether someone is invited.",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(422, 429),
    openapi_extra=roles("anonymous"),
)
async def contact_admin(
    body: ContactAdminRequest, service: AuthService = Depends(get_auth_service)
) -> Response:
    await service.contact_admin(body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@dev_router.post(
    "/sign-in",
    operation_id="devSignIn",
    summary="Dev/test fixed-identity sign-in: a suite session for the person (never in prod)",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses=problem_responses(404, 422),
    openapi_extra=roles("dev"),
)
async def dev_sign_in(
    body: DevSignInRequest,
    service: AuthService = Depends(get_auth_service),
    settings: Settings = Depends(get_settings),
) -> Response:
    token = await service.dev_sign_in(body.user_id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.headers.append("set-cookie", session_cookie(settings.APP_PROFILE, token))
    return response


@dev_router.get(
    "/users",
    operation_id="listDevUsers",
    summary="Active users to pick from on the dev sign-in page",
    response_model=UserRefList,
    response_model_exclude_unset=True,
    openapi_extra=roles("dev"),
)
async def list_dev_users(service: AuthService = Depends(get_auth_service)) -> UserRefList:
    return await service.list_dev_users()
