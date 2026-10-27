from sqlalchemy import case, desc, select
from sqlalchemy.orm import Session

from app.asset_requests.models import AssetRequest
from app.common.enums import AssetRequestStatus


class AssetRequestRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, request_id: int) -> AssetRequest | None:
        return self.db.get(AssetRequest, request_id)

    def list_requests(
        self,
        requested_by: int | None = None,
        status: AssetRequestStatus | None = None,
    ) -> list[AssetRequest]:
        stmt = select(AssetRequest)
        if requested_by is not None:
            stmt = stmt.where(AssetRequest.requested_by == requested_by)
        if status is not None:
            stmt = stmt.where(AssetRequest.status == status)
        pending_first = case(
            (AssetRequest.status == AssetRequestStatus.PENDING, 0),
            else_=1,
        )
        stmt = stmt.order_by(pending_first, desc(AssetRequest.id))
        return list(self.db.scalars(stmt).all())

    def create(
        self,
        *,
        requested_by: int,
        name: str,
        category_id: int | None,
        is_other: bool,
        other_category_name: str | None,
        reason: str,
    ) -> AssetRequest:
        req = AssetRequest(
            requested_by=requested_by,
            name=name.strip(),
            category_id=category_id,
            is_other=is_other,
            other_category_name=other_category_name,
            other_reason=reason,
            reason=reason.strip(),
            serial_no=None,
            service_tag=None,
            asset_tag=None,
            purchase_date=None,
            cost=None,
            location=None,
            status=AssetRequestStatus.PENDING,
            requires_employee_register=False,
        )
        self.db.add(req)
        self.db.flush()
        self.db.refresh(req)
        return req

    def list_pending_employee_register(self, user_id: int) -> list[AssetRequest]:
        """Approved requests still waiting for the employee to register details."""
        stmt = (
            select(AssetRequest)
            .where(
                AssetRequest.requested_by == user_id,
                AssetRequest.status == AssetRequestStatus.APPROVED,
                AssetRequest.requires_employee_register.is_(True),
            )
            .order_by(AssetRequest.id.asc())
        )
        return list(self.db.scalars(stmt).all())

    def clear_oldest_employee_register_flag(self, user_id: int) -> AssetRequest | None:
        """Clear one reminder after the employee registers an asset (FIFO)."""
        pending = self.list_pending_employee_register(user_id)
        if not pending:
            return None
        req = pending[0]
        req.requires_employee_register = False
        self.db.flush()
        self.db.refresh(req)
        return req
