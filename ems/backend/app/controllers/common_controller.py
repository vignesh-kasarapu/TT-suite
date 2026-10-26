"""Lookups every signed-in user needs, plus notifications."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import current_user
from app.models import User
from app.schemas.admin import CategoryOut
from app.schemas.user import UserLookup
from app.schemas.workflow import NotificationOut
from app.services import admin_service, notification_service, policy_view_service, settings_service

router = APIRouter(prefix="/api", tags=["common"])


@router.get("/lookups/categories", response_model=list[CategoryOut])
def categories(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [c for c in admin_service.list_categories(db, only_active=True) if c.kind == "EXPENSE"]


@router.get("/lookups/users", response_model=list[UserLookup])
def users(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(User).where(User.is_active).order_by(User.full_name)).all()


@router.get("/lookups/company-gstins")
def company_gstins(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """FR-7.3: the GSTIN to give the vendor, by state of the expense."""
    return settings_service.get(db, "company_gstins") or {}


@router.get("/lookups/lists")
def lists(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Admin-managed dropdown lists and the claim rules the form needs to show."""
    return {k: settings_service.get(db, k) for k in
            ("projects", "cost_centres", "departments", "require_project", "require_purpose", "late_submission_days")}


@router.get("/policy")
def policy(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Read-only categories and limits for everyone (Categories & policy page)."""
    return policy_view_service.overview(db)


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return notification_service.list_for(db, user.id)


@router.get("/notifications/unread-count")
def unread(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"count": notification_service.unread_count(db, user.id)}


@router.post("/notifications/read-all", status_code=204)
def read_all(user: User = Depends(current_user), db: Session = Depends(get_db)):
    notification_service.mark_all_read(db, user.id)
