"""The signed-in person: dashboard data, theme, photo, card launch, access requests."""

from typing import Any

from fastapi import APIRouter, Depends, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import current_person, get_db, me_service, optional_person
from app.core.errors import not_found
from app.repositories.suite_repository import Person, SuiteRepository
from app.services.me_service import MeService

router = APIRouter(prefix="/api", tags=["me"])


class Preferences(BaseModel):
    preset: str
    mode: str


class AccessRequest(BaseModel):
    app: str
    message: str = Field(default="", max_length=1000)


@router.get("/me")
async def me(person: Person = Depends(current_person), svc: MeService = Depends(me_service)) -> dict[str, Any]:
    return await svc.me(person)


@router.put("/me/preferences")
async def preferences(body: Preferences, person: Person = Depends(current_person),
                      svc: MeService = Depends(me_service)) -> dict[str, str]:
    return await svc.save_preferences(person, body.preset, body.mode)


@router.get("/me/photo")
async def photo(person: Person = Depends(current_person), db: AsyncSession = Depends(get_db)) -> Response:
    found = await SuiteRepository(db).photo(person.id)
    if found is None:
        raise not_found()
    return Response(found[1], media_type=found[0], headers={"cache-control": "private, max-age=3600"})


@router.post("/me/request-access", status_code=204)
async def request_access(body: AccessRequest, person: Person = Depends(current_person),
                         svc: MeService = Depends(me_service)) -> Response:
    await svc.request_access(person, body.app, body.message)
    return Response(status_code=204)


@router.get("/launch/{app}")
async def launch(app: str, person: Person | None = Depends(optional_person),
                 svc: MeService = Depends(me_service)) -> Response:
    """A dashboard card: authorize the role for `app`, then redirect into it."""
    if person is None:
        return RedirectResponse(f"/login?returnTo=/api/launch/{app}", status_code=302)
    return RedirectResponse(await svc.launch(person, app), status_code=302)
