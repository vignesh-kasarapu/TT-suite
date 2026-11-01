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


def set_value(db: Session, key: str, value, value_type: str, updated_by: int) -> dict:
    prior = config_dao.find_by_key(db, key)
    prior_value = prior.config_value if prior else None
    serialized = json.dumps(value) if value_type == "JSON" else str(value).lower() if value_type == "BOOL" else str(value)
    config_dao.upsert(db, key, serialized, value_type, updated_by)
    return {"prior_value": prior_value, "new_value": serialized}


def config_defaults() -> dict[str, tuple[str, str]]:
    """key -> (value, value_type), from seed/reference.json (BR references in each entry's note)."""
    return {key: (d["value"], d["type"]) for key, d in load_required("reference.json")["config_defaults"].items()}


def seed_defaults(db: Session, updated_by: int | None) -> None:
    for key, (value, value_type) in config_defaults().items():
        if config_dao.find_by_key(db, key) is None:
            config_dao.upsert(db, key, value, value_type, updated_by)
