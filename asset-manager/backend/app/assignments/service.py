from datetime import date
import logging
from sqlalchemy.orm import Session

from app.asset_requests.repository import AssetRequestRepository
from app.assets.models import Asset
from app.assets.repository import AssetRepository
from app.assets.schemas import AssetCreateRequest, AssetResponse
from app.assignments.models import Assignment
from app.assignments.repository import AssignmentRepository
from app.assignments.schemas import (
    AssignAssetRequest,
    AssignedAssetResponse,
    AssignmentResponse,
    AssetHistoryResponse,
    EmployeeAssetDetailsRequest,
    ReturnAssetRequest,
)
from app.categories.repository import CategoryRepository
from app.common.audit import log_audit_event
from app.common.database import transactional
from app.common.enums import AssetStatus, UserRole
from app.common.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.maintenance.repository import MaintenanceRepository
from app.maintenance.schemas import MaintenanceRecordResponse
from app.users.models import User
from app.users.repository import UserRepository

logger = logging.getLogger("ams.assignments")


class AssignmentService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = AssignmentRepository(db)
        self.asset_repository = AssetRepository(db)
        self.user_repository = UserRepository(db)
        self.category_repository = CategoryRepository(db)
        self.maintenance_repository = MaintenanceRepository(db)
        self.asset_request_repository = AssetRequestRepository(db)

    @staticmethod
    def _to_assignment_response(
        assignment: Assignment,
        asset_status: AssetStatus | None = None,
    ) -> AssignmentResponse:
        resolved_status = asset_status or (
            assignment.asset_rel.status if assignment.asset_rel is not None else None
        )
        return AssignmentResponse(
            id=assignment.id,
            asset_id=assignment.asset_id,
            asset_tag=assignment.asset_tag,
            asset_name=assignment.asset_name,
            user_id=assignment.user_id,
            user_name=assignment.user_name,
            user_email=assignment.user_email,
            assigned_on=assignment.assigned_on,
            returned_on=assignment.returned_on,
            return_reason=assignment.return_reason,
            asset_status=resolved_status,
            created_at=assignment.created_at,
        )

    @staticmethod
    def _to_assigned_asset_response(assignment: Assignment) -> AssignedAssetResponse:
        asset: Asset = assignment.asset_rel
        return AssignedAssetResponse(
            id=asset.id,
            tag=asset.tag,
            name=asset.name,
            serial_no=asset.serial_no,
            service_tag=asset.service_tag,
            asset_tag=asset.asset_tag,
            category_id=asset.category_id,
            category_name=asset.category_name,
            purchase_date=asset.purchase_date,
            cost=asset.cost,
            location=asset.location,
            status=asset.status,
            awaiting_employee_details=asset.awaiting_employee_details,
            version=asset.version,
            created_at=asset.created_at,
            assignment_id=assignment.id,
            assigned_on=assignment.assigned_on,
            user_id=assignment.user_id,
            user_name=assignment.user_name,
            user_email=assignment.user_email,
        )

    @transactional
    def assign_asset(
        self,
        asset_id: int,
        payload: AssignAssetRequest,
        actor_user_id: int,
        actor_email: str | None = None,
    ) -> AssignmentResponse:
        asset = self.asset_repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")

        assert payload.user_id is not None
        assert payload.assigned_on is not None

        target_user = self.user_repository.get_by_id(payload.user_id)
        if target_user is None:
            raise NotFoundException(f"User with id {payload.user_id} not found")

        if not target_user.active:
            raise ConflictException(
                f"Cannot assign asset to deactivated user '{target_user.email}'"
            )

        if asset.status != AssetStatus.AVAILABLE:
            raise ConflictException(
                f"Cannot assign asset '{asset.tag}' because its status is {asset.status.value}; only AVAILABLE assets can be assigned"
            )

        existing_open = self.repository.get_open_assignment_for_asset(asset.id)
        if existing_open is not None:
            raise ConflictException(
                f"Asset '{asset.tag}' already has an open assignment"
            )

        assignment = self.repository.create(
            asset_id=asset.id,
            user_id=target_user.id,
            assigned_on=payload.assigned_on,
        )

        asset.status = AssetStatus.ASSIGNED
        asset.version += 1
        self.db.flush()
        self.db.refresh(asset)
        self.db.refresh(assignment)

        log_audit_event(
            action="assign",
            actor_user_id=actor_user_id,
            target_user_id=target_user.id,
            asset_id=asset.id,
            asset_tag=asset.tag,
            extra={
                "assignment_id": assignment.id,
                "assigned_to_user_id": target_user.id,
                "assigned_on": payload.assigned_on.isoformat(),
                "actor_email": actor_email,
            },
        )
        return self._to_assignment_response(assignment, asset_status=asset.status)

    @transactional
    def return_asset(
        self,
        asset_id: int,
        payload: ReturnAssetRequest,
        actor_user_id: int,
        actor_email: str | None = None,
    ) -> AssignmentResponse:
        asset = self.asset_repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")

        if asset.status != AssetStatus.ASSIGNED:
            raise ConflictException(
                f"Cannot return asset '{asset.tag}' because its status is {asset.status.value}; only ASSIGNED assets can be returned"
            )

        open_assignment = self.repository.get_open_assignment_for_asset(asset.id)
        if open_assignment is None:
            raise ConflictException(
                f"Asset '{asset.tag}' has no open assignment to return"
            )

        assert payload.returned_on is not None
        assert payload.next_status is not None

        if payload.returned_on < open_assignment.assigned_on:
            raise BadRequestException(
                "Return date cannot be earlier than the assignment date"
            )

        self.repository.close_assignment(
            assignment=open_assignment,
            returned_on=payload.returned_on,
            return_reason=payload.return_reason,
        )

        asset.status = payload.next_status
        asset.version += 1

        if payload.next_status == AssetStatus.IN_MAINTENANCE:
            open_maint = self.maintenance_repository.get_open_by_asset_id(asset.id)
            if open_maint is None:
                assert payload.description is not None
                self.maintenance_repository.create(
                    asset_id=asset.id,
                    opened_on=payload.returned_on,
                    description=payload.description.strip(),
                    cost=None,
                    opened_by=actor_user_id,
                )

        self.db.flush()
        self.db.refresh(asset)
        self.db.refresh(open_assignment)

        log_audit_event(
            action="return",
            actor_user_id=actor_user_id,
            target_user_id=open_assignment.user_id,
            asset_id=asset.id,
            asset_tag=asset.tag,
            extra={
                "assignment_id": open_assignment.id,
                "returned_from_user_id": open_assignment.user_id,
                "returned_on": payload.returned_on.isoformat(),
                "next_status": asset.status.value,
                "return_reason": (
                    open_assignment.return_reason.value
                    if open_assignment.return_reason
                    else None
                ),
                "actor_email": actor_email,
            },
        )
        if payload.next_status == AssetStatus.RETIRED:
            log_audit_event(
                action="retire",
                actor_user_id=actor_user_id,
                asset_id=asset.id,
                asset_tag=asset.tag,
                extra={"source": "return_transition", "actor_email": actor_email},
            )

        return self._to_assignment_response(open_assignment, asset_status=asset.status)

    def get_asset_history(self, asset_id: int) -> AssetHistoryResponse:
        asset = self.asset_repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")

        assignments = self.repository.list_by_asset_id(asset_id)
        maintenance_records = self.maintenance_repository.list_by_asset_id(asset_id)

        return AssetHistoryResponse(
            asset=AssetResponse.model_validate(asset),
            assignments=[
                self._to_assignment_response(a, asset_status=asset.status)
                for a in assignments
            ],
            maintenance_records=[
                MaintenanceRecordResponse.model_validate(m) for m in maintenance_records
            ],
        )

    def list_user_active_assets(self, user_id: int) -> list[AssignedAssetResponse]:
        user = self.user_repository.get_by_id(user_id)
        if user is None:
            raise NotFoundException(f"User with id {user_id} not found")

        open_assignments = self.repository.list_open_by_user_id(user_id)
        return [
            self._to_assigned_asset_response(assignment)
            for assignment in open_assignments
            if assignment.asset_rel is not None
        ]

    def _resolve_category_id_for_register(
        self,
        category_id: int | None,
        category_value: int | str | None,
    ) -> int:
        if category_id is not None:
            cat = self.category_repository.get_by_id(category_id)
            if cat is None:
                raise NotFoundException(f"Category with id {category_id} not found")
            return cat.id

        if category_value is not None:
            if isinstance(category_value, int) or (
                isinstance(category_value, str) and category_value.strip().isdigit()
            ):
                resolved_id = int(str(category_value).strip())
                cat = self.category_repository.get_by_id(resolved_id)
                if cat is None:
                    raise NotFoundException(f"Category with id {resolved_id} not found")
                return cat.id
            if isinstance(category_value, str) and category_value.strip():
                cat = self.category_repository.get_by_name(category_value.strip())
                if cat is None:
                    raise NotFoundException(
                        f"Category '{category_value.strip()}' not found"
                    )
                return cat.id

        raise BadRequestException("category_id is required")

    @transactional
    def register_my_asset(
        self,
        payload: AssetCreateRequest,
        current_user: User,
    ) -> AssignedAssetResponse:
        """Employee registers a physical asset they already hold (create + self-assign)."""
        if current_user.role != UserRole.EMPLOYEE:
            raise ForbiddenException(
                "Only employees can register assets via My Assets; use Asset Register as Admin/Manager"
            )

        category_id = self._resolve_category_id_for_register(
            payload.category_id,
            payload.category,
        )

        existing_serial = self.asset_repository.get_by_serial_no(payload.serial_no)
        if existing_serial is not None:
            raise ConflictException(
                f"Asset with serial_no '{payload.serial_no.strip()}' already exists"
            )
        if payload.service_tag:
            existing_service = self.asset_repository.get_by_service_tag(
                payload.service_tag
            )
            if existing_service is not None:
                raise ConflictException(
                    f"Asset with service_tag '{payload.service_tag.strip()}' already exists"
                )
        if payload.asset_tag:
            existing_asset_tag = self.asset_repository.get_by_asset_tag(payload.asset_tag)
            if existing_asset_tag is not None:
                raise ConflictException(
                    f"Asset with asset_tag '{payload.asset_tag.strip()}' already exists"
                )

        category_obj = self.category_repository.get_by_id(category_id)
        category_name = category_obj.name if category_obj is not None else "Asset"
        tag = self.asset_repository.generate_next_tag(
            category_name=category_name,
            category_id=category_id,
            asset_name=payload.name,
        )
        asset = self.asset_repository.create(
            tag=tag,
            name=payload.name,
            serial_no=payload.serial_no,
            service_tag=payload.service_tag,
            asset_tag=payload.asset_tag,
            category_id=category_id,
            purchase_date=payload.purchase_date,
            cost=payload.cost,
            location=payload.location,
            awaiting_employee_details=False,
        )

        assignment = self.repository.create(
            asset_id=asset.id,
            user_id=current_user.id,
            assigned_on=date.today(),
        )
        asset.status = AssetStatus.ASSIGNED
        asset.version += 1
        self.db.flush()
        self.db.refresh(asset)
        self.db.refresh(assignment)

        cleared = self.asset_request_repository.clear_oldest_employee_register_flag(
            current_user.id
        )
        if cleared is not None:
            logger.info(
                "Cleared requires_employee_register on asset request id=%s after register",
                cleared.id,
            )

        log_audit_event(
            action="assign",
            actor_user_id=current_user.id,
            target_user_id=current_user.id,
            asset_id=asset.id,
            asset_tag=asset.tag,
            extra={
                "source": "employee_register",
                "cleared_request_id": cleared.id if cleared is not None else None,
            },
        )
        logger.info(
            "Employee registered asset id=%s tag=%s assigned_to=%s",
            asset.id,
            asset.tag,
            current_user.id,
        )
        return self._to_assigned_asset_response(assignment)

    @transactional
    def fill_my_asset_details(
        self,
        asset_id: int,
        user_id: int,
        payload: EmployeeAssetDetailsRequest,
    ) -> AssignedAssetResponse:
        """One-time employee details fill on a held asset."""
        open_assignment = self.repository.get_open_assignment_for_asset(asset_id)
        if open_assignment is None or open_assignment.user_id != user_id:
            raise ConflictException(
                "You can only fill details for assets currently assigned to you"
            )

        asset = self.asset_repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")

        if asset.awaiting_employee_details:
            if not payload.name:
                raise ConflictException("Asset name is required")
            if not payload.serial_no:
                raise ConflictException("Serial number is required")
            if payload.purchase_date is None:
                raise ConflictException("Purchase date is required")
            if payload.cost is None:
                raise ConflictException("Cost is required")
            if not payload.location:
                raise ConflictException("Location is required")

            existing_serial = self.asset_repository.get_by_serial_no(payload.serial_no)
            if existing_serial is not None and existing_serial.id != asset.id:
                raise ConflictException(
                    f"Asset with serial_no '{payload.serial_no}' already exists"
                )
            if payload.service_tag:
                existing_service = self.asset_repository.get_by_service_tag(
                    payload.service_tag
                )
                if existing_service is not None and existing_service.id != asset.id:
                    raise ConflictException(
                        f"Asset with service_tag '{payload.service_tag}' already exists"
                    )
            if payload.asset_tag:
                existing_asset_tag = self.asset_repository.get_by_asset_tag(
                    payload.asset_tag
                )
                if existing_asset_tag is not None and existing_asset_tag.id != asset.id:
                    raise ConflictException(
                        f"Asset with asset_tag '{payload.asset_tag}' already exists"
                    )

            asset.name = payload.name
            asset.serial_no = payload.serial_no
            asset.service_tag = payload.service_tag
            asset.asset_tag = payload.asset_tag
            asset.purchase_date = payload.purchase_date
            asset.cost = payload.cost
            asset.location = payload.location
            asset.awaiting_employee_details = False
        else:
            if payload.service_tag is None and payload.asset_tag is None:
                raise ConflictException(
                    "Provide at least one of service_tag or asset_tag"
                )
            if payload.service_tag is not None:
                if asset.service_tag:
                    raise ConflictException(
                        "Service tag is already set and cannot be edited by the employee; "
                        "request a change from an Admin or Asset Manager by email"
                    )
                existing = self.asset_repository.get_by_service_tag(payload.service_tag)
                if existing is not None and existing.id != asset.id:
                    raise ConflictException(
                        f"Asset with service_tag '{payload.service_tag}' already exists"
                    )
                asset.service_tag = payload.service_tag

            if payload.asset_tag is not None:
                if asset.asset_tag:
                    raise ConflictException(
                        "Asset tag is already set and cannot be edited by the employee; "
                        "request a change from an Admin or Asset Manager by email"
                    )
                existing = self.asset_repository.get_by_asset_tag(payload.asset_tag)
                if existing is not None and existing.id != asset.id:
                    raise ConflictException(
                        f"Asset with asset_tag '{payload.asset_tag}' already exists"
                    )
                asset.asset_tag = payload.asset_tag

        asset.version += 1
        self.db.flush()
        self.db.refresh(asset)
        self.db.refresh(open_assignment)

        logger.info(
            "Employee filled asset details asset_id=%s user_id=%s awaiting_cleared=%s",
            asset.id,
            user_id,
            not asset.awaiting_employee_details,
        )
        return self._to_assigned_asset_response(open_assignment)
