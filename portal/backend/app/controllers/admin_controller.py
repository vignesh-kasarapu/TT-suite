"""Global administration (global admin only): people, per-app access, directory, audit."""

from typing import Any

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import admin_service, apps_client, get_db, global_admin
from app.repositories.suite_repository import Person, SuiteRepository
from app.services.admin_service import AdminService, AppGrant, ChangeReport, Invite
from app.services.apps_client import AppsClient

router = APIRouter(prefix="/api/admin", tags=["admin"])


class Grant(BaseModel):
    role: str | None = None
    leadTeamIds: list[str] = Field(default_factory=list)  # noqa: N815 - JSON contract is camelCase


class InviteBody(BaseModel):
    email: str = Field(max_length=254)
    name: str = Field(default="", max_length=200)
    isGlobalAdmin: bool = False  # noqa: N815
    access: dict[str, Grant] = Field(default_factory=dict)


class BulkInviteBody(BaseModel):
    people: list[InviteBody] = Field(min_length=1, max_length=500)


class PersonPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    isGlobalAdmin: bool | None = None  # noqa: N815
    status: str | None = Field(default=None, pattern="^(active|inactive)$")


def _grants(access: dict[str, Grant]) -> dict[str, AppGrant]:
    return {app: AppGrant(g.role, list(g.leadTeamIds)) for app, g in access.items()}


def person_json(p: Person, access: dict[str, str | None]) -> dict[str, Any]:
    return {
        "id": p.id, "email": p.email, "name": p.name, "status": p.status,
        "isGlobalAdmin": p.is_global_admin, "invitedAt": p.invited_at, "lastLoginAt": p.last_login_at,
        "access": {"kanban": access.get("kanban"), "lms": access.get("lms"), "expense": access.get("expense")},
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
    return report_json(await svc.invite(actor, email=body.email, name=body.name,
                                        is_global_admin=body.isGlobalAdmin, grants=_grants(body.access)), request)


@router.post("/users/bulk")
async def bulk_invite(request: Request, body: BulkInviteBody, actor: Person = Depends(global_admin),
                      svc: AdminService = Depends(admin_service)) -> dict[str, Any]:
    """CSV import. One result per person, in the order sent: `ok` with the user and any app that
    refused, or not `ok` with the reason (e.g. ALREADY_INVITED)."""
    invites = [Invite(p.email, p.name, p.isGlobalAdmin, _grants(p.access)) for p in body.people]
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
    return report_json(await svc.update_person(actor, user_id, name=body.name,
                                               is_global_admin=body.isGlobalAdmin, status=body.status), request)


@router.post("/users/{user_id}/resend-invite", status_code=204)
async def resend(user_id: str, actor: Person = Depends(global_admin), svc: AdminService = Depends(admin_service)) -> Response:
    await svc.resend_invite(actor, user_id)
    return Response(status_code=204)


@router.get("/kanban-teams")
async def kanban_teams(_: Person = Depends(global_admin), apps: AppsClient = Depends(apps_client)) -> list[dict[str, str]]:
    return await apps.kanban_teams()


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
