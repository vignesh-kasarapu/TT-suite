from datetime import date, datetime, timezone
import logging
from sqlalchemy.orm import Session

from app.asset_requests.repository import AssetRequestRepository
from app.asset_requests.schemas import (
    ApproveAssetRequest,
    AssetRequestCreate,
    AssetRequestResponse,
    AvailableAssetsForRequestResponse,
    RejectAssetRequest,
)
from app.assets.repository import AssetRepository
from app.assets.schemas import AssetResponse
from app.assignments.repository import AssignmentRepository
from app.categories.repository import CategoryRepository
from app.common.audit import log_audit_event
from app.common.database import transactional
from app.common.enums import AssetRequestStatus, AssetStatus, UserRole
from app.common.exceptions import (
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.users.models import User
from app.users.repository import UserRepository

logger = logging.getLogger("ams.asset_requests")


class AssetRequestService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = AssetRequestRepository(db)
        self.category_repository = CategoryRepository(db)
        self.asset_repository = AssetRepository(db)
        self.assignment_repository = AssignmentRepository(db)
        self.user_repository = UserRepository(db)

    def list_requests(
        self,
        current_user: User,
        status: AssetRequestStatus | None = None,
    ) -> list[AssetRequestResponse]:
        requested_by = (
            current_user.id if current_user.role == UserRole.EMPLOYEE else None
        )
        records = self.repository.list_requests(
            requested_by=requested_by,
            status=status,
        )
        return [AssetRequestResponse.model_validate(r) for r in records]

    def _preview_category_id(
        self,
        req,
        category_id_override: int | None,
    ) -> tuple[int | None, str | None]:
        """Resolve category for stock check without creating new Other categories."""
        if category_id_override is not None:
            category = self.category_repository.get_by_id(category_id_override)
            if category is None:
                raise NotFoundException(
                    f"Category with id {category_id_override} not found"
                )
            return category.id, category.name

        if not req.is_other:
            if req.category_id is None:
                return None, None
            category = self.category_repository.get_by_id(req.category_id)
            if category is None:
                raise NotFoundException(
                    f"Category with id {req.category_id} not found"
                )
            return category.id, category.name

        if req.other_category_name:
            existing = self.category_repository.get_by_name(req.other_category_name)
            if existing is not None:
                return existing.id, existing.name
        return None, req.other_category_name

    def list_available_assets_for_request(
        self,
        request_id: int,
        category_id: int | None = None,
    ) -> AvailableAssetsForRequestResponse:
        req = self.repository.get_by_id(request_id)
        if req is None:
            raise NotFoundException(f"Asset request with id {request_id} not found")

        resolved_id, resolved_name = self._preview_category_id(req, category_id)
        if resolved_id is None:
            return AvailableAssetsForRequestResponse(
                category_id=None,
                category_name=resolved_name,
                has_available=False,
                items=[],
            )

        assets = self.asset_repository.list_available_by_category(resolved_id)
        items = [AssetResponse.model_validate(a) for a in assets]
        return AvailableAssetsForRequestResponse(
            category_id=resolved_id,
            category_name=resolved_name,
            has_available=len(items) > 0,
            items=items,
        )

    @transactional
    def create_request(
        self,
        payload: AssetRequestCreate,
        current_user: User,
    ) -> AssetRequestResponse:
        if current_user.role != UserRole.EMPLOYEE:
            raise ForbiddenException(
                "Only employees can submit asset requests; use Asset Register to create assets directly"
            )

        display_name: str
        if not payload.is_other:
            assert payload.category_id is not None
            category = self.category_repository.get_by_id(payload.category_id)
            if category is None:
                raise NotFoundException(
                    f"Category with id {payload.category_id} not found"
                )
            display_name = category.name
        else:
            assert payload.other_category_name is not None
            display_name = payload.other_category_name

        req = self.repository.create(
            requested_by=current_user.id,
            name=display_name,
            category_id=payload.category_id,
            is_other=payload.is_other,
            other_category_name=payload.other_category_name,
            reason=payload.reason,
        )
        logger.info(
            "Asset request created id=%s by user_id=%s name=%s is_other=%s",
            req.id,
            current_user.id,
            req.name,
            req.is_other,
        )
        return AssetRequestResponse.model_validate(req)

    def _resolve_category_for_approve(
        self,
        req,
        payload: ApproveAssetRequest,
    ) -> tuple[int, str]:
        if payload.category_id is not None:
            category = self.category_repository.get_by_id(payload.category_id)
            if category is None:
                raise NotFoundException(
                    f"Category with id {payload.category_id} not found"
                )
            return category.id, category.name

        if not req.is_other:
            if req.category_id is None:
                raise ConflictException(
                    "Asset request is missing a catalogue category"
                )
            category = self.category_repository.get_by_id(req.category_id)
            if category is None:
                raise NotFoundException(
                    f"Category with id {req.category_id} not found"
                )
            return category.id, category.name

        assert req.other_category_name is not None
        existing = self.category_repository.get_by_name(req.other_category_name)
        if existing is not None:
            return existing.id, existing.name
        created = self.category_repository.create(req.other_category_name)
        return created.id, created.name

    def _assign_available_asset(
        self,
        *,
        asset_id: int,
        category_id: int,
        requester_id: int,
        actor_user_id: int,
        request_id: int,
    ):
        asset = self.asset_repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")
        if asset.category_id != category_id:
            raise ConflictException(
                f"Asset '{asset.tag}' is not in the request category"
            )
        if asset.status != AssetStatus.AVAILABLE:
            raise ConflictException(
                f"Cannot assign asset '{asset.tag}' because its status is {asset.status.value}; "
                "only AVAILABLE assets can be assigned"
            )

        requester = self.user_repository.get_by_id(requester_id)
        if requester is None:
            raise NotFoundException(f"User with id {requester_id} not found")
        if not requester.active:
            raise ConflictException(
                f"Cannot assign asset to deactivated user '{requester.email}'"
            )

        existing_open = self.assignment_repository.get_open_assignment_for_asset(
            asset.id
        )
        if existing_open is not None:
            raise ConflictException(
                f"Asset '{asset.tag}' already has an open assignment"
            )

        assignment = self.assignment_repository.create(
            asset_id=asset.id,
            user_id=requester.id,
            assigned_on=date.today(),
        )
        asset.status = AssetStatus.ASSIGNED
        asset.version += 1
        self.db.flush()
        self.db.refresh(asset)
        self.db.refresh(assignment)

        log_audit_event(
            action="assign",
            actor_user_id=actor_user_id,
            target_user_id=requester.id,
            asset_id=asset.id,
            asset_tag=asset.tag,
            extra={
                "source": "asset_request_approve",
                "asset_request_id": request_id,
                "assignment_id": assignment.id,
            },
        )
        return asset

    @transactional
    def approve_request(
        self,
        request_id: int,
        payload: ApproveAssetRequest,
        actor_user_id: int,
    ) -> AssetRequestResponse:
        """Approve; assign AVAILABLE stock when asset_id given, else employee-register path when no stock."""
        req = self.repository.get_by_id(request_id)
        if req is None:
            raise NotFoundException(f"Asset request with id {request_id} not found")

        if req.status != AssetRequestStatus.PENDING:
            raise ConflictException(
                f"Asset request #{req.id} cannot be approved because its status is {req.status.value}"
            )

        category_id, category_name = self._resolve_category_for_approve(req, payload)
        display_name = (
            req.other_category_name
            if req.is_other and req.other_category_name
            else category_name
        )

        available = self.asset_repository.list_available_by_category(category_id)
        assigned_asset = None

        if payload.asset_id is not None:
            assigned_asset = self._assign_available_asset(
                asset_id=payload.asset_id,
                category_id=category_id,
                requester_id=req.requested_by,
                actor_user_id=actor_user_id,
                request_id=req.id,
            )
            requires_employee_register = False
        else:
            if available:
                raise ConflictException(
                    "AVAILABLE assets exist for this category; select one to assign on approve"
                )
            requires_employee_register = payload.requires_employee_register

        req.status = AssetRequestStatus.APPROVED
        req.category_id = category_id
        req.name = display_name
        req.requires_employee_register = requires_employee_register
        req.decided_by = actor_user_id
        req.decision_comment = payload.comment
        req.decided_at = datetime.now(timezone.utc)
        if assigned_asset is not None:
            req.created_asset_id = assigned_asset.id

        self.db.flush()
        self.db.refresh(req)

        logger.info(
            "Asset request approved id=%s category_id=%s asset_id=%s "
            "requires_employee_register=%s by actor_user_id=%s",
            req.id,
            category_id,
            assigned_asset.id if assigned_asset is not None else None,
            req.requires_employee_register,
            actor_user_id,
        )
        return AssetRequestResponse.model_validate(req)

    @transactional
    def reject_request(
        self,
        request_id: int,
        payload: RejectAssetRequest,
        actor_user_id: int,
    ) -> AssetRequestResponse:
        req = self.repository.get_by_id(request_id)
        if req is None:
            raise NotFoundException(f"Asset request with id {request_id} not found")

        if req.status != AssetRequestStatus.PENDING:
            raise ConflictException(
                f"Asset request #{req.id} cannot be rejected because its status is {req.status.value}"
            )

        assert payload.comment is not None
        req.status = AssetRequestStatus.REJECTED
        req.decided_by = actor_user_id
        req.decision_comment = payload.comment
        req.decided_at = datetime.now(timezone.utc)

        self.db.flush()
        self.db.refresh(req)
        logger.info(
            "Asset request rejected id=%s by actor_user_id=%s",
            req.id,
            actor_user_id,
        )
        return AssetRequestResponse.model_validate(req)
