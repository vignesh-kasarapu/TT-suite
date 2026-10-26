"""Thin — mirrors backend/src/controllers/notificationAdmin.controller.js.
HR_ADMIN only (mounted under /admin in Node, same here)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import created, ok
from app.schemas.notification_template import (
    NotificationTemplateActiveIn,
    NotificationTemplateCreateIn,
    NotificationTemplateOut,
    NotificationTemplateUpdateIn,
)
from app.services import notification_template_service

router = APIRouter(dependencies=[Depends(require_role("HR_ADMIN"))])


@router.get("")
def list_templates(db: Session = Depends(get_db)):
    rows = notification_template_service.list_templates(db)
    return ok([NotificationTemplateOut.model_validate(r).model_dump() for r in rows])


@router.post("", status_code=201)
def create_template(payload: NotificationTemplateCreateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = notification_template_service.create_template(
        db, payload.template_key, payload.subject_template, payload.body_template, user.employee_id,
    )
    return created(NotificationTemplateOut.model_validate(row).model_dump())


@router.patch("/{template_key}")
def update_template(template_key: str, payload: NotificationTemplateUpdateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = notification_template_service.update_template(
        db, template_key, payload.subject_template, payload.body_template, user.employee_id,
    )
    return ok(NotificationTemplateOut.model_validate(row).model_dump())


@router.patch("/{template_key}/active")
def set_template_active(template_key: str, payload: NotificationTemplateActiveIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    row = notification_template_service.set_template_active(db, template_key, payload.is_active, user.employee_id)
    return ok(NotificationTemplateOut.model_validate(row).model_dump())


@router.delete("/{template_key}")
def delete_template(template_key: str, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = notification_template_service.delete_template(db, template_key, user.employee_id)
    return ok(result)
