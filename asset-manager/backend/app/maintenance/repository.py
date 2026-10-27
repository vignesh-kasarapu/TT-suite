from datetime import date
from decimal import Decimal
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.maintenance.models import MaintenanceRecord


class MaintenanceRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, record_id: int) -> MaintenanceRecord | None:
        return self.db.get(MaintenanceRecord, record_id)

    def get_open_by_asset_id(self, asset_id: int) -> MaintenanceRecord | None:
        stmt = select(MaintenanceRecord).where(
            MaintenanceRecord.asset_id == asset_id,
            MaintenanceRecord.closed_on.is_(None),
        )
        return self.db.scalar(stmt)

    def list_by_asset_id(self, asset_id: int) -> list[MaintenanceRecord]:
        stmt = (
            select(MaintenanceRecord)
            .where(MaintenanceRecord.asset_id == asset_id)
            .order_by(desc(MaintenanceRecord.opened_on), desc(MaintenanceRecord.id))
        )
        return list(self.db.scalars(stmt).all())

    def list_all(
        self,
        asset_id: int | None = None,
        open_only: bool | None = None,
    ) -> list[MaintenanceRecord]:
        stmt = select(MaintenanceRecord)
        if asset_id is not None:
            stmt = stmt.where(MaintenanceRecord.asset_id == asset_id)
        if open_only is True:
            stmt = stmt.where(MaintenanceRecord.closed_on.is_(None))
        stmt = stmt.order_by(desc(MaintenanceRecord.opened_on), desc(MaintenanceRecord.id))
        return list(self.db.scalars(stmt).all())

    def create(
        self,
        asset_id: int,
        opened_on: date,
        description: str,
        cost: Decimal | None = None,
        replacement_request_id: int | None = None,
        opened_by: int | None = None,
    ) -> MaintenanceRecord:
        record = MaintenanceRecord(
            asset_id=asset_id,
            replacement_request_id=replacement_request_id,
            opened_by=opened_by,
            opened_on=opened_on,
            closed_on=None,
            description=description.strip(),
            cost=cost,
        )
        self.db.add(record)
        self.db.flush()
        self.db.refresh(record)
        return record
