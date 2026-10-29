"""Global administration (global admin only): people, per-app access, directory, audit."""

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import admin_service, apps_client, get_db, global_admin
from app.core.errors import not_found
from app.repositories.suite_repository import Person, SuiteRepository
from app.services.admin_service import AdminService, AppGrant, ChangeReport, Invite
from app.services.apps_client import AppsClient
from suite_core.constants import active_apps, is_active

router = APIRouter(prefix="/api/admin", tags=["admin"])


class Grant(BaseModel):
    role: str | None = None
    leadTeamIds: list[str] = Field(default_factory=list)  # noqa: N815 - JSON contract is camelCase


class InviteBody(BaseModel):
    email: str = Field(max_length=254)
    name: str = Field(default="", max_length=200)
    employeeCode: str = Field(default="", max_length=40)  # noqa: N815 - required by the service
    isGlobalAdmin: bool = False  # noqa: N815
    access: dict[str, Grant] = Field(default_factory=dict)


class BulkInviteBody(BaseModel):
    people: list[InviteBody] = Field(min_length=1, max_length=500)


class PersonPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    employeeCode: str | None = Field(default=None, max_length=40)  # noqa: N815
    email: str | None = Field(default=None, max_length=254)
    jobTitle: str | None = Field(default=None, max_length=120)  # noqa: N815
    phone: str | None = Field(default=None, max_length=40)
    location: str | None = Field(default=None, max_length=120)
    isGlobalAdmin: bool | None = None  # noqa: N815
    status: str | None = Field(default=None, pattern="^(active|inactive)$")


def _grants(access: dict[str, Grant]) -> dict[str, AppGrant]:
    return {app: AppGrant(g.role, list(g.leadTeamIds)) for app, g in access.items()}


def person_json(p: Person, access: dict[str, str | None]) -> dict[str, Any]:
    return {
        "id": p.id, "email": p.email, "name": p.name, "status": p.status, "employeeCode": p.employee_code,
        "isGlobalAdmin": p.is_global_admin, "invitedAt": p.invited_at, "lastLoginAt": p.last_login_at,
        "access": {app: access.get(app) for app in active_apps()},
    }


def report_json(r: ChangeReport, request: Request) -> dict[str, Any]:
    # mailDelivery tells the admin whether the invite really leaves (graph/smtp) or is only
    # recorded (stub, local development).
    return {"user": person_json(r.person, r.access), "errors": r.errors,
            "mailDelivery": request.app.state.settings.MAIL_PROVIDER}


@router.get("/users")
async def users(q: str | None = None, _: Person = Depends(global_admin), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    repo = SuiteRepository(db)
    access = await repo.access_all()
    return {"items": [person_json(p, access.get(p.id, {})) for p in await repo.list_people(q)]}


@router.post("/users", status_code=201)
async def invite(request: Request, body: InviteBody, actor: Person = Depends(global_admin), svc: AdminService = Depends(admin_service)) -> dict[str, Any]:
    return report_json(await svc.invite(actor, email=body.email, name=body.name, is_global_admin=body.isGlobalAdmin,
                                        grants=_grants(body.access), employee_code=body.employeeCode), request)


@router.post("/users/bulk")
async def bulk_invite(request: Request, body: BulkInviteBody, actor: Person = Depends(global_admin),
                      svc: AdminService = Depends(admin_service)) -> dict[str, Any]:
    """CSV import. One result per person, in the order sent: `ok` with the user and any app that
    refused, or not `ok` with the reason (e.g. ALREADY_INVITED)."""
    invites = [Invite(p.email, p.name, p.isGlobalAdmin, _grants(p.access), p.employeeCode) for p in body.people]
    results = await svc.invite_many(actor, invites)
    return {
        "results": [
            {"email": r.person.email, "ok": True, "user": person_json(r.person, r.access), "errors": r.errors}
            if isinstance(r, ChangeReport)
            else {"email": i.email.strip().lower(), "ok": False, "code": r.code, "detail": r.detail}
            for i, r in zip(invites, results, strict=True)
        ],
        "mailDelivery": request.app.state.settings.MAIL_PROVIDER,
    }


@router.put("/users/{user_id}/access")
async def set_access(request: Request, user_id: str, body: dict[str, Grant], actor: Person = Depends(global_admin),
                     svc: AdminService = Depends(admin_service)) -> dict[str, Any]:
    return report_json(await svc.set_access(actor, user_id, _grants(body)), request)


@router.patch("/users/{user_id}")
async def patch_person(request: Request, user_id: str, body: PersonPatch, actor: Person = Depends(global_admin),
                       svc: AdminService = Depends(admin_service)) -> dict[str, Any]:
    return report_json(await svc.update_person(
        actor, user_id, name=body.name, is_global_admin=body.isGlobalAdmin, status=body.status,
        employee_code=body.employeeCode, email=body.email, job_title=body.jobTitle, phone=body.phone,
        location=body.location), request)


@router.get("/users/{user_id}/details")
async def person_details(user_id: str, _: Person = Depends(global_admin), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """What the global admin's "Edit details" dialog starts from."""
    repo = SuiteRepository(db)
    person = await repo.person_by_id(user_id)
    if person is None:
        raise not_found("No such person.")
    return {"id": person.id, "name": person.name, "email": person.email, "employeeCode": person.employee_code,
            **await repo.profile_details(user_id)}


@router.post("/users/{user_id}/resend-invite")
async def resend(user_id: str, request: Request, actor: Person = Depends(global_admin),
                 svc: AdminService = Depends(admin_service)) -> dict[str, str]:
    await svc.resend_invite(actor, user_id)
    # mailDelivery: graph/smtp = really sent; stub = only recorded (development mode).
    return {"mailDelivery": request.app.state.settings.MAIL_PROVIDER}


class Decision(BaseModel):
    note: str = Field(default="", max_length=1000)


@router.get("/role-requests")
async def role_requests(_: Person = Depends(global_admin), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Open role requests (from app admins and "Request access"), then the most recent decisions."""
    return {"items": await SuiteRepository(db).role_requests()}


@router.post("/role-requests/{request_id}/approve")
async def approve_request(request_id: int, body: Decision, actor: Person = Depends(global_admin),
                          svc: AdminService = Depends(admin_service)) -> dict[str, Any]:
    return await svc.decide_role_request(actor, request_id, approve=True, note=body.note)


@router.post("/role-requests/{request_id}/decline")
async def decline_request(request_id: int, body: Decision, actor: Person = Depends(global_admin),
                          svc: AdminService = Depends(admin_service)) -> dict[str, Any]:
    return await svc.decide_role_request(actor, request_id, approve=False, note=body.note)


@router.get("/kanban-teams")
async def kanban_teams(_: Person = Depends(global_admin), apps: AppsClient = Depends(apps_client)) -> list[dict[str, str]]:
    return await apps.kanban_teams() if is_active("kanban") else []


@router.get("/directory")
async def directory(request: Request, q: str = Query(min_length=2, max_length=100),
                    _: Person = Depends(global_admin)) -> dict[str, Any]:
    """Tenant people for the invite picker (Graph, needs User.Read.All). Empty when Graph is off."""
    graph = request.app.state.graph
    if not graph.configured:
        return {"available": False, "items": []}
    status, items = await graph.search_users(q.replace('"', ""))
    return {
        "available": status < 400,
        "items": [
            {"name": i.get("displayName") or "", "email": str(i.get("mail") or i.get("userPrincipalName") or "").lower()}
            for i in items
            if i.get("accountEnabled", True) and (i.get("mail") or i.get("userPrincipalName"))
        ],
    }


@router.get("/audit")
async def audit(limit: int = Query(default=100, ge=1, le=500), _: Person = Depends(global_admin),
                db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return {"items": await SuiteRepository(db).audit_page(limit)}
