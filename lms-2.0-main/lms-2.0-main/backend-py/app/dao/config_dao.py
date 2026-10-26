from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.org_config import OrganizationConfig


def find_by_key(db: Session, key: str) -> OrganizationConfig | None:
    return db.get(OrganizationConfig, key)


def find_by_keys(db: Session, keys: list[str]) -> list[OrganizationConfig]:
    return list(db.execute(select(OrganizationConfig).where(OrganizationConfig.config_key.in_(keys))).scalars())


def list_all(db: Session) -> list[OrganizationConfig]:
    return list(db.execute(select(OrganizationConfig).order_by(OrganizationConfig.config_key)).scalars())


def upsert(db: Session, key: str, value: str, value_type: str, updated_by: int | None) -> OrganizationConfig:
    row = find_by_key(db, key)
    if row is None:
        row = OrganizationConfig(config_key=key, config_value=value, value_type=value_type, updated_by=updated_by)
        db.add(row)
    else:
        row.config_value = value
        row.value_type = value_type
        row.updated_by = updated_by
    db.commit()
    db.refresh(row)
    return row
