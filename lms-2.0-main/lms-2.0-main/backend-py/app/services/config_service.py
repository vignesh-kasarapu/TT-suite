"""Mirrors backend/src/services/config.service.js exactly — every [CONFIG]
value from the FRD lives in organization_configs, never hardcoded in business
logic. The database is the sole source of truth after seed_defaults() runs
once; there is no runtime fallback default anywhere else in the app."""
import json

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.dao import config_dao

# key -> (value, value_type). BR references match the Node original's comments.
CONFIG_DEFAULTS: dict[str, tuple[str, str]] = {
    "leave_year.start_month_day": ("04-01", "STRING"),  # BR-01
    "weekend.days": ('["SAT","SUN"]', "JSON"),  # BR-03
    "weekend.count_within_leave": ("false", "BOOL"),  # BR-04
    "holiday.count_within_leave": ("false", "BOOL"),  # BR-04
    "timezone": ("Asia/Kolkata", "STRING"),
    "approval.long_leave_threshold_days": ("10", "INT"),  # BR-23
    "approval.sla_working_days": ("3", "INT"),  # BR-33
    "approval.sla_reminder_days_before": ("1", "INT"),  # BR-34
    "backdating.window_days": ("30", "INT"),  # BR-27
    "advance_leave.withdrawal_window_days": ("7", "INT"),  # BR-18
    "sick_leave.alert_threshold_days": ("3", "INT"),  # BR-43
    "sick_leave.alert_supervisor_enabled": ("true", "BOOL"),  # BR-45
    "sick_leave.alert_hr_enabled": ("true", "BOOL"),  # BR-45
    "sick_leave.medical_cert_threshold_days": ("3", "INT"),  # sick requests longer than this need a medical attachment
    "leave.max_days_per_request": ("15", "INT"),  # max deducted working days in one request; 0 = no limit
    "holiday.optional_holiday_quota_override": ("0", "INT"),  # 0 = auto-compute
}


def _cast(value: str, value_type: str):
    if value_type == "INT":
        return int(value)
    if value_type == "BOOL":
        return value == "true" or value is True
    if value_type == "JSON":
        return json.loads(value)
    return value


def get(db: Session, key: str):
    row = config_dao.find_by_key(db, key)
    if row is None:
        raise AppError("CONFIG_NOT_SEEDED", f"Config key '{key}' has not been seeded.", status=500)
    return _cast(row.config_value, row.value_type)


def get_many(db: Session, keys: list[str]) -> dict:
    rows = {r.config_key: r for r in config_dao.find_by_keys(db, keys)}
    missing = [k for k in keys if k not in rows]
    if missing:
        raise AppError("CONFIG_NOT_SEEDED", f"Config keys not seeded: {', '.join(missing)}", status=500)
    return {k: _cast(rows[k].config_value, rows[k].value_type) for k in keys}


def set_value(db: Session, key: str, value, value_type: str, updated_by: int) -> dict:
    prior = config_dao.find_by_key(db, key)
    prior_value = prior.config_value if prior else None
    serialized = json.dumps(value) if value_type == "JSON" else str(value).lower() if value_type == "BOOL" else str(value)
    config_dao.upsert(db, key, serialized, value_type, updated_by)
    return {"prior_value": prior_value, "new_value": serialized}


def seed_defaults(db: Session, updated_by: int | None) -> None:
    for key, (value, value_type) in CONFIG_DEFAULTS.items():
        if config_dao.find_by_key(db, key) is None:
            config_dao.upsert(db, key, value, value_type, updated_by)
