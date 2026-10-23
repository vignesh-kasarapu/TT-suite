"""Request-scoped dependencies: the DB session, the signed-in person, the global-admin gate."""

from collections.abc import AsyncIterator

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import forbidden, unauthenticated
from app.repositories.suite_repository import Person, SuiteRepository
from app.services.admin_service import AdminService
from app.services.apps_client import AppsClient
from app.services.auth_service import AuthService
from app.services.me_service import MeService
from suite_core import identity
from suite_core.constants import session_cookie_name


def get_settings(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session  # closing rolls back whatever was not committed


def session_cookie(request: Request) -> str | None:
    return request.cookies.get(session_cookie_name(request.app.state.settings.APP_PROFILE))


async def optional_person(request: Request, db: AsyncSession = Depends(get_db)) -> Person | None:
    who = await identity.aresolve(db, session_cookie(request), None)
    if who is None:
        return None
    return await SuiteRepository(db).person_by_id(who.user_id)


async def current_person(person: Person | None = Depends(optional_person)) -> Person:
    if person is None:
        raise unauthenticated()
    return person


async def global_admin(person: Person = Depends(current_person)) -> Person:
    if not person.is_global_admin:
        raise forbidden()
    return person


def apps_client(request: Request) -> AppsClient:
    return AppsClient(request.app.state.settings, request.app.state.http)


def auth_service(request: Request, db: AsyncSession = Depends(get_db)) -> AuthService:
    s = request.app.state
    return AuthService(db, s.settings, s.entra, s.graph)


def admin_service(request: Request, db: AsyncSession = Depends(get_db)) -> AdminService:
    return AdminService(db, request.app.state.settings, apps_client(request))


def me_service(request: Request, db: AsyncSession = Depends(get_db)) -> MeService:
    return MeService(db, request.app.state.settings, apps_client(request))
