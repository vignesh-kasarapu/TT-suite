"""Thin — mirrors backend/src/routes/config.routes.js. HR_ADMIN only."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import CurrentUser, require_role
from app.core.responses import ok
from app.dao import config_dao
from app.schemas.config import ConfigOut, ConfigUpdateIn
from app.services import audit_service, config_service

router = APIRouter()


@router.get("")
def list_all(db: Session = Depends(get_db), _user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    rows = config_dao.list_all(db)
    return ok([ConfigOut.model_validate(r, from_attributes=True).model_dump() for r in rows])


@router.patch("/{key}")
def update_one(key: str, payload: ConfigUpdateIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require_role("HR_ADMIN"))):
    result = config_service.set_value(db, key, payload.value, payload.value_type, user.employee_id)
    audit_service.record(
        db, action="CONFIG_UPDATED", entity_type="organization_configs", entity_id=key,
        actor_id=user.employee_id, prior_value=result["prior_value"], new_value=result["new_value"],
    )
    return ok({"key": key, **result})
