"""Authentication and structural authorisation (ADR-005, ADR-007).

Every operation declares its roles in `x-roles` (shown in the OpenAPI document);
`RoleRoute` turns that declaration into the `authorize` dependency, and refuses to register an
operation that declares none - nothing can be mounted without an access decision.

`authorize` runs before the request's parameters and body are validated, so 401/403 never
depend on the body being valid. Order per request: suite session cookie -> Actor (from the
database, every request; SUITE-CONTRACT §3.1) -> policy over x-roles. A person signed in to the
suite without Kanban access gets 403 NO_APP_ACCESS where a session is needed, 401 stays "no
session". Object-level rules (ownership, team membership, private
plane) are applied in the services.
"""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Depends, Request
from fastapi.params import Depends as DependsParam
from fastapi.routing import APIRoute

from app.core.config import Settings
from app.core.security import Actor, Role, can, session_cookie_name
from app.dependencies.database import get_settings
from app.dependencies.services import get_auth_service
from app.exceptions.custom_exceptions import (
    ForbiddenException,
    NoAppAccessException,
    UnauthenticatedException,
)
from app.services.auth_service import AuthService

X_ROLES = "x-roles"


def roles(*names: Role) -> dict[str, Any]:
    """`openapi_extra=roles("member")` on a route: who may call it."""
    return {X_ROLES: list(names)}


def _authorize(x_roles: list[Role]) -> Callable[..., Coroutine[Any, Any, None]]:
    async def authorize(
        request: Request,
        settings: Settings = Depends(get_settings),
        auth: AuthService = Depends(get_auth_service),
    ) -> None:
        cookie = request.cookies.get(session_cookie_name(settings.APP_PROFILE))
        found = await auth.resolve_actor(cookie)
        request.state.actor = found.actor
        if found.expired:
            # The pipeline middleware adds the clearing Set-Cookie (the suite cookie's name) to
            # whatever the response is.
            request.state.clear_session_cookie = True
        decision = can(found.actor, x_roles, settings.APP_PROFILE)
        if decision == "unauthenticated":
            if found.no_access:
                raise NoAppAccessException()
            raise UnauthenticatedException()
        if decision == "forbidden":
            raise ForbiddenException()

    return authorize


class RoleRoute(APIRoute):
    def __init__(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        extra = kwargs.get("openapi_extra") or {}
        x_roles = extra.get(X_ROLES)
        if not x_roles:
            raise RuntimeError(f"{path} declares no x-roles; every operation needs an access rule")
        deps: list[DependsParam] = list(kwargs.get("dependencies") or [])
        kwargs["dependencies"] = [Depends(_authorize(list(x_roles))), *deps]
        # A response carries the keys the service set, nothing more: an optional field that does
        # not apply is left out rather than sent as null (as the API has always behaved).
        kwargs["response_model_exclude_unset"] = True
        super().__init__(path, endpoint, **kwargs)


def current_actor(request: Request) -> Actor:
    """The signed-in caller of a member/admin operation (`authorize` already ran)."""
    actor: Actor | None = getattr(request.state, "actor", None)
    if actor is None:
        raise UnauthenticatedException()
    return actor
