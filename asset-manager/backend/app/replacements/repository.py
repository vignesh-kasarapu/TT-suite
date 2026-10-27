from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.common.enums import OldAssetAction, ReplacementStatus
from app.replacements.models import ReplacementRequest


class ReplacementRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, request_id: int) -> ReplacementRequest | None:
        return self.db.get(ReplacementRequest, request_id)

    def get_pending_by_asset_id(self, asset_id: int) -> ReplacementRequest | None:
        """Open decision: still PENDING or ON_HOLD (awaiting stock)."""
        stmt = select(ReplacementRequest).where(
            ReplacementRequest.asset_id == asset_id,
            ReplacementRequest.status.in_(
                (ReplacementStatus.PENDING, ReplacementStatus.ON_HOLD)
            ),
        )
        return self.db.scalar(stmt)

    def list_requests(
        self,
        requested_by: int | None = None,
        status: ReplacementStatus | None = None,
    ) -> list[ReplacementRequest]:
        stmt = select(ReplacementRequest)
        if requested_by is not None:
            stmt = stmt.where(ReplacementRequest.requested_by == requested_by)
        if status is not None:
            stmt = stmt.where(ReplacementRequest.status == status)
        stmt = stmt.order_by(desc(ReplacementRequest.id))
        return list(self.db.scalars(stmt).all())

    def create(
        self,
        asset_id: int,
        requested_by: int,
        reason: str,
        old_asset_action: OldAssetAction,
        temporary: bool,
    ) -> ReplacementRequest:
        req = ReplacementRequest(
            asset_id=asset_id,
            requested_by=requested_by,
            reason=reason.strip(),
            old_asset_action=old_asset_action,
            temporary=temporary,
            status=ReplacementStatus.PENDING,
        )
        self.db.add(req)
        self.db.flush()
        self.db.refresh(req)
        return req
