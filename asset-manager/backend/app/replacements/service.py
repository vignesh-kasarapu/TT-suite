from datetime import date, datetime, timezone
import logging
from sqlalchemy.orm import Session

from app.assets.repository import AssetRepository
from app.assignments.repository import AssignmentRepository
from app.common.audit import log_audit_event
from app.common.database import transactional
from app.common.enums import (
    AssetStatus,
    OldAssetAction,
    ReplacementStatus,
    ReturnReason,
    UserRole,
)
from app.common.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
)
from app.maintenance.repository import MaintenanceRepository
from app.replacements.repository import ReplacementRepository
from app.replacements.schemas import (
    ApproveReplacementRequest,
    RejectReplacementRequest,
    ReplacementRequestCreate,
    ReplacementRequestResponse,
)
from app.users.models import User

logger = logging.getLogger("ams.replacements")


class ReplacementService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = ReplacementRepository(db)
        self.asset_repository = AssetRepository(db)
        self.assignment_repository = AssignmentRepository(db)
        self.maintenance_repository = MaintenanceRepository(db)

    def list_requests(
        self,
        current_user: User,
        status: ReplacementStatus | None = None,
    ) -> list[ReplacementRequestResponse]:
        requested_by = (
            current_user.id if current_user.role == UserRole.EMPLOYEE else None
        )
        records = self.repository.list_requests(
            requested_by=requested_by,
            status=status,
        )
        return [ReplacementRequestResponse.model_validate(r) for r in records]

    @transactional
    def create_request(
        self,
        payload: ReplacementRequestCreate,
        current_user: User,
    ) -> ReplacementRequestResponse:
        assert payload.asset_id is not None
        assert payload.old_asset_action is not None

        if payload.temporary and payload.old_asset_action == OldAssetAction.RETIRE:
            raise BadRequestException(
                "Temporary replacement requests require old_asset_action to be REPAIR"
            )

        asset = self.asset_repository.get_by_id(payload.asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {payload.asset_id} not found")

        open_assignment = self.assignment_repository.get_open_assignment_for_asset(
            asset.id
        )
        if (
            asset.status != AssetStatus.ASSIGNED
            or open_assignment is None
            or open_assignment.user_id != current_user.id
        ):
            raise ConflictException(
                f"Asset '{asset.tag}' is not currently assigned to you"
            )

        existing_pending = self.repository.get_pending_by_asset_id(asset.id)
        if existing_pending is not None:
            raise ConflictException(
                f"Asset '{asset.tag}' already has a pending replacement request"
            )

        req = self.repository.create(
            asset_id=asset.id,
            requested_by=current_user.id,
            reason=payload.reason,
            old_asset_action=payload.old_asset_action,
            temporary=payload.temporary,
        )
        return ReplacementRequestResponse.model_validate(req)

    @transactional
    def approve_request(
        self,
        request_id: int,
        payload: ApproveReplacementRequest,
        actor_user_id: int,
    ) -> ReplacementRequestResponse:
        assert payload.replacement_asset_id is not None

        req = self.repository.get_by_id(request_id)
        if req is None:
            raise NotFoundException(
                f"Replacement request with id {request_id} not found"
            )

        if req.status not in (
            ReplacementStatus.PENDING,
            ReplacementStatus.ON_HOLD,
        ):
            raise ConflictException(
                f"Replacement request #{req.id} cannot be approved because its status is {req.status.value}"
            )

        old_asset = self.asset_repository.get_by_id(req.asset_id)
        if old_asset is None:
            raise NotFoundException(f"Original asset with id {req.asset_id} not found")

        open_assignment = self.assignment_repository.get_open_assignment_for_asset(
            old_asset.id
        )
        if (
            old_asset.status != AssetStatus.ASSIGNED
            or open_assignment is None
            or open_assignment.user_id != req.requested_by
        ):
            raise ConflictException(
                f"Original asset '{old_asset.tag}' is no longer assigned to the requesting employee"
            )

        today = date.today()

        # Step 1 (Atomic Transaction): Return old asset with return_reason = REPLACEMENT
        self.assignment_repository.close_assignment(
            assignment=open_assignment,
            returned_on=today,
            return_reason=ReturnReason.REPLACEMENT,
        )

        # Step 2 (Atomic Transaction): Transition old asset to IN_MAINTENANCE or RETIRED
        if req.old_asset_action == OldAssetAction.REPAIR:
            old_asset.status = AssetStatus.IN_MAINTENANCE
            old_asset.version += 1
            self.maintenance_repository.create(
                asset_id=old_asset.id,
                opened_on=today,
                description=f"Replacement Request #{req.id} repair: {req.reason}",
                replacement_request_id=req.id,
                opened_by=req.requested_by,
            )
        else:
            old_asset.status = AssetStatus.RETIRED
            old_asset.version += 1

        self.db.flush()

        # Step 3 (Atomic Transaction): Validate and assign the selected AVAILABLE replacement asset
        new_asset = self.asset_repository.get_by_id(payload.replacement_asset_id)
        if new_asset is None:
            raise NotFoundException(
                f"Replacement asset with id {payload.replacement_asset_id} not found"
            )

        if new_asset.id == old_asset.id:
            raise ConflictException(
                "Replacement asset cannot be the same as the asset being replaced"
            )

        if new_asset.status != AssetStatus.AVAILABLE:
            raise ConflictException(
                f"Replacement asset '{new_asset.tag}' cannot be assigned because its status is {new_asset.status.value} (must be AVAILABLE)"
            )

        if new_asset.category_id != old_asset.category_id:
            raise ConflictException(
                f"Replacement asset '{new_asset.tag}' must be in the same category as "
                f"'{old_asset.tag}' (category_id={old_asset.category_id})"
            )

        new_asset_open_assignment = (
            self.assignment_repository.get_open_assignment_for_asset(new_asset.id)
        )
        if new_asset_open_assignment is not None:
            raise ConflictException(
                f"Replacement asset '{new_asset.tag}' already has an open assignment"
            )

        self.assignment_repository.create(
            asset_id=new_asset.id,
            user_id=req.requested_by,
            assigned_on=today,
        )
        new_asset.status = AssetStatus.ASSIGNED
        new_asset.version += 1

        # Step 4 (Atomic Transaction): Mark replacement request as APPROVED
        req.replacement_asset_id = new_asset.id
        req.status = ReplacementStatus.APPROVED
        req.decided_by = actor_user_id
        req.decision_comment = payload.comment
        req.decided_at = datetime.now(timezone.utc)

        self.db.flush()
        self.db.refresh(req)

        # Structured audit logs for return, optional retire, and new assignment
        log_audit_event(
            action="return",
            actor_user_id=actor_user_id,
            target_user_id=req.requested_by,
            asset_id=old_asset.id,
            asset_tag=old_asset.tag,
            extra={
                "old_asset_action": req.old_asset_action.value,
                "return_reason": ReturnReason.REPLACEMENT.value,
                "replacement_request_id": req.id,
            },
        )
        if req.old_asset_action == OldAssetAction.RETIRE:
            log_audit_event(
                action="retire",
                actor_user_id=actor_user_id,
                asset_id=old_asset.id,
                asset_tag=old_asset.tag,
                extra={"replacement_request_id": req.id},
            )
        log_audit_event(
            action="assign",
            actor_user_id=actor_user_id,
            target_user_id=req.requested_by,
            asset_id=new_asset.id,
            asset_tag=new_asset.tag,
            extra={"replacement_request_id": req.id},
        )

        return ReplacementRequestResponse.model_validate(req)

    @transactional
    def reject_request(
        self,
        request_id: int,
        payload: RejectReplacementRequest,
        actor_user_id: int,
    ) -> ReplacementRequestResponse:
        assert payload.comment is not None

        req = self.repository.get_by_id(request_id)
        if req is None:
            raise NotFoundException(
                f"Replacement request with id {request_id} not found"
            )

        if req.status not in (
            ReplacementStatus.PENDING,
            ReplacementStatus.ON_HOLD,
        ):
            raise ConflictException(
                f"Replacement request #{req.id} cannot be rejected because its status is {req.status.value}"
            )

        req.status = ReplacementStatus.REJECTED
        req.decided_by = actor_user_id
        req.decision_comment = payload.comment
        req.decided_at = datetime.now(timezone.utc)

        self.db.flush()
        self.db.refresh(req)
        return ReplacementRequestResponse.model_validate(req)

    @transactional
    def hold_request(
        self,
        request_id: int,
        actor_user_id: int,
        comment: str | None = None,
    ) -> ReplacementRequestResponse:
        """Mark as ON_HOLD when no matching AVAILABLE stock — visible to employee and managers."""
        req = self.repository.get_by_id(request_id)
        if req is None:
            raise NotFoundException(
                f"Replacement request with id {request_id} not found"
            )

        if req.status not in (
            ReplacementStatus.PENDING,
            ReplacementStatus.ON_HOLD,
        ):
            raise ConflictException(
                f"Replacement request #{req.id} cannot be put on hold because its status is {req.status.value}"
            )

        req.status = ReplacementStatus.ON_HOLD
        if comment and comment.strip():
            req.decision_comment = comment.strip()
        # Not a final decision — leave decided_by/decided_at unset so Approve/Reject remain available.
        self.db.flush()
        self.db.refresh(req)
        logger.info(
            "Replacement request id=%s marked ON_HOLD by actor_user_id=%s",
            req.id,
            actor_user_id,
        )
        return ReplacementRequestResponse.model_validate(req)
