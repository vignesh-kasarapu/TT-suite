from decimal import Decimal
from typing import Any
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.assets.models import Asset
from app.assignments.models import Assignment
from app.categories.models import Category
from app.common.enums import AssetStatus
from app.users.models import User


class ReportsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_status_counts_and_value(self) -> tuple[dict[str, int], int, float]:
        counts: dict[str, int] = {
            AssetStatus.AVAILABLE.value: 0,
            AssetStatus.ASSIGNED.value: 0,
            AssetStatus.IN_MAINTENANCE.value: 0,
            AssetStatus.RETIRED.value: 0,
        }

        stmt = select(
            Asset.status,
            func.count(Asset.id),
            func.coalesce(func.sum(Asset.cost), 0),
        ).group_by(Asset.status)

        total_assets = 0
        total_value = Decimal("0.00")

        for status_val, cnt, sum_cost in self.db.execute(stmt).all():
            key = status_val.value if isinstance(status_val, AssetStatus) else str(status_val)
            count_int = int(cnt or 0)
            counts[key] = count_int
            total_assets += count_int
            total_value += Decimal(str(sum_cost or 0))

        return counts, total_assets, round(float(total_value), 2)

    def get_category_breakdown(self) -> list[dict[str, Any]]:
        stmt = (
            select(
                Category.id,
                Category.name,
                func.count(Asset.id).label("total"),
                func.coalesce(
                    func.sum(case((Asset.status == AssetStatus.AVAILABLE, 1), else_=0)),
                    0,
                ).label("available"),
                func.coalesce(
                    func.sum(case((Asset.status == AssetStatus.ASSIGNED, 1), else_=0)),
                    0,
                ).label("assigned"),
                func.coalesce(
                    func.sum(case((Asset.status == AssetStatus.IN_MAINTENANCE, 1), else_=0)),
                    0,
                ).label("in_maintenance"),
                func.coalesce(
                    func.sum(case((Asset.status == AssetStatus.RETIRED, 1), else_=0)),
                    0,
                ).label("retired"),
                func.coalesce(func.sum(Asset.cost), 0).label("total_value"),
            )
            .outerjoin(Asset, Asset.category_id == Category.id)
            .group_by(Category.id, Category.name)
            .order_by(Category.id.asc())
        )

        rows = self.db.execute(stmt).all()
        result: list[dict[str, Any]] = []
        for row in rows:
            result.append(
                {
                    "category_id": int(row.id),
                    "category_name": str(row.name),
                    "total": int(row.total or 0),
                    "available": int(row.available or 0),
                    "assigned": int(row.assigned or 0),
                    "in_maintenance": int(row.in_maintenance or 0),
                    "retired": int(row.retired or 0),
                    "total_value": round(float(row.total_value or 0), 2),
                }
            )
        return result

    def get_assets_for_csv(
        self,
        status: AssetStatus | None = None,
        category_id: int | None = None,
        search: str | None = None,
    ) -> list[dict[str, Any]]:
        stmt = (
            select(
                Asset.id,
                Asset.tag,
                Asset.name,
                Asset.serial_no,
                Asset.service_tag,
                Asset.asset_tag,
                Asset.category_id,
                Category.name.label("category_name"),
                Asset.status,
                Asset.location,
                Asset.purchase_date,
                Asset.cost,
                Asset.awaiting_employee_details,
                Asset.version,
                User.name.label("assigned_to_name"),
                User.email.label("assigned_to_email"),
                Asset.created_at,
            )
            .join(Category, Asset.category_id == Category.id)
            .outerjoin(
                Assignment,
                and_(
                    Assignment.asset_id == Asset.id,
                    Assignment.returned_on.is_(None),
                ),
            )
            .outerjoin(User, Assignment.user_id == User.id)
        )

        if status is not None:
            stmt = stmt.where(Asset.status == status)
        if category_id is not None:
            stmt = stmt.where(Asset.category_id == category_id)
        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(Asset.name).like(term),
                    func.lower(Asset.tag).like(term),
                    func.lower(Asset.service_tag).like(term),
                    func.lower(Asset.asset_tag).like(term),
                    func.lower(Asset.serial_no).like(term),
                )
            )

        stmt = stmt.order_by(Asset.id.asc())
        rows = self.db.execute(stmt).all()

        export_rows: list[dict[str, Any]] = []
        for r in rows:
            status_str = r.status.value if isinstance(r.status, AssetStatus) else str(r.status)
            export_rows.append(
                {
                    "id": r.id,
                    "tag": r.tag,
                    "name": r.name,
                    "serial_no": r.serial_no or "",
                    "service_tag": r.service_tag or "",
                    "asset_tag": r.asset_tag or "",
                    "category_id": r.category_id,
                    "category": r.category_name,
                    "status": status_str,
                    "location": r.location or "",
                    "purchase_date": r.purchase_date.isoformat() if r.purchase_date else "",
                    "cost": f"{float(r.cost):.2f}" if r.cost is not None else "0.00",
                    "assigned_to_name": r.assigned_to_name or "",
                    "assigned_to_email": r.assigned_to_email or "",
                    "awaiting_employee_details": (
                        "true" if r.awaiting_employee_details else "false"
                    ),
                    "version": r.version,
                    "created_at": r.created_at.isoformat() if r.created_at else "",
                }
            )
        return export_rows
