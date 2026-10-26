"""Thin — mirrors backend/src/routes/notification.routes.js +
notificationCentre.controller.js. requireAuth only, self-service."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, get_current_user
from app.core.responses import ok
from app.schemas.notification_centre import NotificationOut
from app.services import notification_centre_service

router = APIRouter()


@router.get("")
def list_notifications(unread_only: bool = False, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    rows = notification_centre_service.list_for_employee(db, user.employee_id, unread_only)
    return ok([NotificationOut.model_validate(r).model_dump() for r in rows])


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    return ok({"count": notification_centre_service.unread_count(db, user.employee_id)})


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    notification = notification_centre_service.mark_read(db, notification_id, user.employee_id)
    return ok(NotificationOut.model_validate(notification).model_dump())


@router.post("/mark-all-read")
def mark_all_read(db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    notification_centre_service.mark_all_read(db, user.employee_id)
    return ok({"marked": True})
