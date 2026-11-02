"""The signed-in person: dashboard data, theme, photo, card launch, access requests."""

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import current_person, get_db, me_service, optional_person, session_cookie
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


class ProfileEdit(BaseModel):
    """A person's own details. Anything left out keeps its current value; the apps copy
    what they keep on the person's next request."""

    name: str = Field(max_length=200)
    jobTitle: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    location: str | None = Field(default=None, max_length=120)
    personalEmail: str | None = Field(default=None, max_length=255)
    dateOfBirth: str | None = Field(default=None, max_length=10)  # YYYY-MM-DD, "" clears it
    emergencyContactName: str | None = Field(default=None, max_length=120)
    emergencyContactPhone: str | None = Field(default=None, max_length=30)
    gender: str | None = Field(default=None, max_length=20)
    maritalStatus: str | None = Field(default=None, max_length=20)


class MarkRead(BaseModel):
    ids: list[int] | None = None  # None = everything


@router.put("/me/profile")
async def update_profile(body: ProfileEdit, person: Person = Depends(current_person),
                         svc: MeService = Depends(me_service)) -> dict[str, Any]:
    return await svc.update_profile(
        person, body.name,
        job_title=body.jobTitle, phone=body.phone, location=body.location,
        personal_email=body.personalEmail, date_of_birth=body.dateOfBirth,
        emergency_contact_name=body.emergencyContactName,
        emergency_contact_phone=body.emergencyContactPhone,
        gender=body.gender, marital_status=body.maritalStatus,
    )


@router.get("/me/sessions")
async def sessions(request: Request, person: Person = Depends(current_person),
                   svc: MeService = Depends(me_service)) -> dict[str, Any]:
    """The devices the person is signed in on (for "sign out of all devices")."""
    return {"items": await svc.sessions(person, session_cookie(request))}


@router.get("/me/inbox")
async def inbox(person: Person = Depends(current_person), svc: MeService = Depends(me_service)) -> dict[str, Any]:
    return await svc.inbox(person)


@router.post("/me/inbox/read", status_code=204)
async def mark_read(body: MarkRead, person: Person = Depends(current_person),
                    svc: MeService = Depends(me_service)) -> Response:
    await svc.mark_read(person, body.ids)
    return Response(status_code=204)


@router.put("/me/photo")
async def upload_photo(request: Request, person: Person = Depends(current_person),
                       svc: MeService = Depends(me_service)) -> dict[str, Any]:
    """The image itself is the request body (Content-Type image/png, image/jpeg or image/webp)."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    return await svc.set_photo(person, content_type, await request.body())


@router.delete("/me/photo")
async def remove_photo(person: Person = Depends(current_person), svc: MeService = Depends(me_service)) -> dict[str, Any]:
    return await svc.set_photo(person, "", None)


@router.delete("/me/sessions/{key}", status_code=204)
async def end_session(key: str, request: Request, person: Person = Depends(current_person),
                      svc: MeService = Depends(me_service)) -> Response:
    await svc.end_session(person, key, session_cookie(request))
    return Response(status_code=204)


@router.get("/me/photo")
async def photo(person: Person = Depends(current_person), db: AsyncSession = Depends(get_db)) -> Response:
    found = await SuiteRepository(db).photo(person.id)
    if found is None:
        raise not_found()
    return Response(found[1], media_type=found[0], headers={"cache-control": "private, no-cache"})


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
