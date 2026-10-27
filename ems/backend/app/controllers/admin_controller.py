from datetime import date

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_role
from app.models import User
from app.models.enums import Role
from app.schemas.admin import AuditOut, CategoryIn, CategoryOut, LimitIn, LimitOut, ReassignIn
from app.schemas.user import RoleRequestIn, UserAdminOut, UserDetailsIn
from app.services import admin_service, report_service, scheduler_service, settings_service

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_only = require_role(Role.ADMIN)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# users
@router.get("/users", response_model=list[UserAdminOut])
def users(user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.list_users(db)


# Creating people, roles, access, names and emails belong to the TT Suite global admin (portal).
# The EMS Admin edits Expense-only details and asks the global admin for role changes.
@router.put("/users/{user_id}", response_model=UserAdminOut)
def update_user(user_id: int, data: UserDetailsIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.save_details(db, user, user_id, data)


@router.post("/users/{user_id}/role-request")
def request_role(user_id: int, data: RoleRequestIn, request: Request, user: User = Depends(admin_only),
                 db: Session = Depends(get_db)):
    return admin_service.request_role_change(db, user, request.state.suite.user_id, user_id, data)


@router.get("/role-requests")
def role_requests(user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.role_requests(db)


@router.get("/last-change")
def last_change(entity: str | None = None, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.last_change(db, entity)


# categories
@router.get("/categories", response_model=list[CategoryOut])
def categories(user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.list_categories(db)


@router.post("/categories", response_model=CategoryOut)
def create_category(data: CategoryIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.save_category(db, user, data)


@router.put("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: int, data: CategoryIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.save_category(db, user, data, category_id)


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    admin_service.delete_category(db, user, category_id)


# policy limits
@router.get("/limits", response_model=list[LimitOut])
def limits(user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.list_limits(db)


@router.post("/limits", response_model=LimitOut)
def create_limit(data: LimitIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.save_limit(db, user, data)


@router.put("/limits/{limit_id}", response_model=LimitOut)
def update_limit(limit_id: int, data: LimitIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.save_limit(db, user, data, limit_id)


# settings
@router.get("/settings")
def get_settings(user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return settings_service.get_all(db)


@router.put("/settings")
def update_settings(changes: dict = Body(...), user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return admin_service.update_settings(db, user, changes)


# operations
@router.post("/reassign")
def reassign(data: ReassignIn, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    step = admin_service.reassign_step(db, user, data)
    return {"claim_id": step.claim_id}


@router.post("/run-reminders")
def run_reminders(user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return scheduler_service.run_reminders(db)


# reports and audit
@router.get("/dashboard")
def dashboard(start: date | None = None, end: date | None = None, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return report_service.dashboard(db, start, end)


def _audit_rows(db, user_id, claim_no, level, start, end) -> list[dict]:
    rows = report_service.audit_query(db, user_id, claim_no, level, start, end)
    numbers = report_service.claim_numbers(db, {r.claim_id for r in rows if r.claim_id})
    return [AuditOut.model_validate({
        **{f: getattr(r, f) for f in ("id", "at", "action", "entity", "entity_id", "claim_id", "level", "amount", "self_approved", "details")},
        "actor_name": r.actor.full_name if r.actor else "System",
        "on_behalf_of_name": r.on_behalf_of.full_name if r.on_behalf_of else None,
        "claim_no": numbers.get(r.claim_id),
    }).model_dump() for r in rows]


@router.get("/audit", response_model=list[AuditOut])
def audit(user_id: int | None = None, claim_no: str | None = None, level: str | None = None, start: date | None = None,
          end: date | None = None, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    return _audit_rows(db, user_id, claim_no, level, start, end)


@router.get("/audit/export")
def audit_export(user_id: int | None = None, claim_no: str | None = None, level: str | None = None, start: date | None = None,
                 end: date | None = None, user: User = Depends(admin_only), db: Session = Depends(get_db)):
    data = report_service.export_audit(_audit_rows(db, user_id, claim_no, level, start, end))
    return Response(data, media_type=XLSX, headers={"Content-Disposition": 'attachment; filename="audit-log.xlsx"'})
