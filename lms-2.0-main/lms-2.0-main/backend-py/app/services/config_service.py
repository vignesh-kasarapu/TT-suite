"""Mirrors backend/src/services/config.service.js exactly — every [CONFIG]
value from the FRD lives in organization_configs, never hardcoded in business
logic. The database is the sole source of truth after seed_defaults() runs
once; there is no runtime fallback default anywhere else in the app. The defaults
seed_defaults() writes live in seed/reference.json under `config_defaults`."""
import json

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.seed_data import load_required
from app.dao import config_dao

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


def get_or_default(db: Session, key: str, default):
    """For keys added after a database was first seeded: `seed_defaults` only runs on a
    fresh schema, so an older database has no row for them. The caller's default stands in
    until HR saves a value."""
    row = config_dao.find_by_key(db, key)
    return default if row is None else _cast(row.config_value, row.value_type)


def get_many(db: Session, keys: list[str]) -> dict:
    rows = {r.config_key: r for r in config_dao.find_by_keys(db, keys)}
    missing = [k for k in keys if k not in rows]
    if missing:
        raise AppError("CONFIG_NOT_SEEDED", f"Config keys not seeded: {', '.join(missing)}", status=500)
    return {k: _cast(rows[k].config_value, rows[k].value_type) for k in keys}


# Whole-number settings with a range (inclusive).
INT_RANGES = {"holiday.optional_holidays_allowed": (0, 365)}


def set_value(db: Session, key: str, value, value_type: str, updated_by: int) -> dict:
    if key in RETIRED_KEYS:
        raise AppError("CONFIG_RETIRED", f"'{key}' is no longer used.", status=400)
    if key in INT_RANGES:
        low, high = INT_RANGES[key]
        try:
            number = int(str(value))
        except ValueError:
            number = None
        if number is None or not low <= number <= high:
            raise AppError("VALIDATION_ERROR", f"Enter a whole number from {low} to {high}.", status=400)
    prior = config_dao.find_by_key(db, key)
    prior_value = prior.config_value if prior else None
    serialized = json.dumps(value) if value_type == "JSON" else str(value).lower() if value_type == "BOOL" else str(value)
    config_dao.upsert(db, key, serialized, value_type, updated_by)
    return {"prior_value": prior_value, "new_value": serialized}


# Keys no longer read by the app: hidden from the Settings list (their old rows stay, unused).
RETIRED_KEYS = frozenset({"holiday.optional_holiday_quota_override"})


def list_for_settings(db: Session) -> list[dict]:
    """Every setting HR can change: the saved rows, plus the reference.json defaults an older
    database never got (seed_defaults only runs on a fresh schema). Saving one stores it."""
    rows = {r.config_key: r for r in config_dao.list_all(db) if r.config_key not in RETIRED_KEYS}
    out = [{"config_key": r.config_key, "config_value": r.config_value, "value_type": r.value_type,
            "description": r.description} for r in rows.values()]
    defaults = load_required("reference.json")["config_defaults"]
    out += [{"config_key": key, "config_value": d["value"], "value_type": d["type"], "description": d.get("note")}
            for key, d in defaults.items() if key not in rows and key not in RETIRED_KEYS]
    return sorted(out, key=lambda r: r["config_key"])


def config_defaults() -> dict[str, tuple[str, str]]:
    """key -> (value, value_type), from seed/reference.json (BR references in each entry's note)."""
    return {key: (d["value"], d["type"]) for key, d in load_required("reference.json")["config_defaults"].items()}


def seed_defaults(db: Session, updated_by: int | None) -> None:
    for key, (value, value_type) in config_defaults().items():
        if config_dao.find_by_key(db, key) is None:
            config_dao.upsert(db, key, value, value_type, updated_by)
