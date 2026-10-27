from datetime import date
import logging
from sqlalchemy.orm import Session

from app.assets.repository import AssetRepository
from app.assignments.repository import AssignmentRepository
from app.common.audit import log_audit_event
from app.common.database import transactional
from app.common.enums import AssetStatus, ReplacementStatus, ReturnReason, UserRole
from app.common.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
)
from app.maintenance.models import MaintenanceRecord
from app.maintenance.repository import MaintenanceRepository
from app.maintenance.schemas import (
    MaintenanceCloseRequest,
    MaintenanceCreateRequest,
    MaintenanceRecordResponse,
)
from app.replacements.repository import ReplacementRepository
from app.users.models import User

logger = logging.getLogger("ams.maintenance")


class MaintenanceService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = MaintenanceRepository(db)
        self.asset_repository = AssetRepository(db)
        self.assignment_repository = AssignmentRepository(db)
        self.replacement_repository = ReplacementRepository(db)

    def _to_response(self, record: MaintenanceRecord) -> MaintenanceRecordResponse:
        data = MaintenanceRecordResponse.model_validate(record)

        if record.replacement_request_id is not None:
            linked = self.replacement_repository.get_by_id(record.replacement_request_id)
            if linked is not None:
                employee_name = linked.requester_name
                return data.model_copy(
                    update={
                        "requested_by_name": employee_name,
                        "requested_by_role": UserRole.EMPLOYEE,
                        "employee_name": employee_name,
                        "reason": linked.reason or record.description,
                        "temporary": linked.temporary,
                        "old_asset_action": linked.old_asset_action,
                        "replacement_status": linked.status,
                    }
                )

        employee_name = self.assignment_repository.get_employee_name_for_maintenance(
            asset_id=record.asset_id,
            opened_on=record.opened_on,
        )

        # Keep requested_by_* as opener for audit-compatible consumers
        opener: User | None = record.opened_by_rel
        if opener is None and record.opened_by is not None:
            opener = self.db.get(User, record.opened_by)

        return data.model_copy(
            update={
                "reason": record.description,
                "employee_name": employee_name,
                "requested_by_name": opener.name if opener is not None else None,
                "requested_by_role": opener.role if opener is not None else None,
            }
        )

    def list_maintenance_records(
        self,
        asset_id: int | None = None,
        open_only: bool | None = None,
    ) -> list[MaintenanceRecordResponse]:
        records = self.repository.list_all(asset_id=asset_id, open_only=open_only)
        return [self._to_response(r) for r in records]

    @transactional
    def open_maintenance(
        self,
        asset_id: int,
        payload: MaintenanceCreateRequest,
        actor_user_id: int,
    ) -> MaintenanceRecordResponse:
        asset = self.asset_repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")

        if asset.status == AssetStatus.RETIRED:
            raise ConflictException(
                f"Cannot log maintenance for asset '{asset.tag}' because it is RETIRED"
            )

        if asset.status == AssetStatus.ASSIGNED:
            raise ConflictException(
                f"Cannot log standalone maintenance for asset '{asset.tag}' while it is ASSIGNED; return it first"
            )

        existing_open = self.repository.get_open_by_asset_id(asset.id)
        if asset.status == AssetStatus.IN_MAINTENANCE or existing_open is not None:
            raise ConflictException(
                f"Asset '{asset.tag}' is already IN_MAINTENANCE with an open maintenance record"
            )

        assert payload.opened_on is not None
        record = self.repository.create(
            asset_id=asset.id,
            opened_on=payload.opened_on,
            description=payload.description,
            cost=payload.cost,
            opened_by=actor_user_id,
        )

        asset.status = AssetStatus.IN_MAINTENANCE
        asset.version += 1
        self.db.flush()
        self.db.refresh(asset)
        self.db.refresh(record)

        logger.info(
            "Opened maintenance record id=%s asset_id=%s tag=%s actor_user_id=%s",
            record.id,
            asset.id,
            asset.tag,
            actor_user_id,
        )
        return self._to_response(record)

    @transactional
    def close_maintenance(
        self,
        record_id: int,
        payload: MaintenanceCloseRequest,
        actor_user_id: int,
    ) -> MaintenanceRecordResponse:
        record = self.repository.get_by_id(record_id)
        if record is None:
            raise NotFoundException(f"Maintenance record with id {record_id} not found")

        if record.closed_on is not None:
            raise ConflictException(
                f"Maintenance record {record_id} is already closed"
            )

        closed_on = (
            payload.closed_on if payload.closed_on is not None else date.today()
        )
        if closed_on < record.opened_on:
            raise BadRequestException(
                "Maintenance closed_on date cannot be earlier than opened_on date"
            )

        record.closed_on = closed_on
        record.resolution = payload.resolution
        if payload.cost is not None:
            record.cost = payload.cost
        if payload.description is not None:
            record.description = payload.description

        asset = self.asset_repository.get_by_id(record.asset_id)

        # FR-18: Check if linked to an APPROVED temporary replacement request
        linked_req = (
            self.replacement_repository.get_by_id(record.replacement_request_id)
            if record.replacement_request_id is not None
            else None
        )

        if (
            linked_req is not None
            and linked_req.status == ReplacementStatus.APPROVED
            and linked_req.temporary is True
        ):
            # 1. Automatically return the temporary replacement asset to AVAILABLE
            if linked_req.replacement_asset_id is not None:
                temp_asset = self.asset_repository.get_by_id(
                    linked_req.replacement_asset_id
                )
                temp_open_assignment = (
                    self.assignment_repository.get_open_assignment_for_asset(
                        linked_req.replacement_asset_id
                    )
                )
                if temp_open_assignment is not None:
                    self.assignment_repository.close_assignment(
                        assignment=temp_open_assignment,
                        returned_on=closed_on,
                        return_reason=ReturnReason.REPLACEMENT,
                    )
                if temp_asset is not None:
                    temp_asset.status = AssetStatus.AVAILABLE
                    temp_asset.version += 1
                    log_audit_event(
                        action="return",
                        actor_user_id=actor_user_id,
                        target_user_id=linked_req.requested_by,
                        asset_id=temp_asset.id,
                        asset_tag=temp_asset.tag,
                        extra={
                            "event_type": "fr18_auto_return_temp_replacement",
                            "replacement_request_id": linked_req.id,
                        },
                    )

            # 2. Return repaired original to AVAILABLE for manual reassignment
            if asset is not None:
                asset.status = AssetStatus.AVAILABLE
                asset.version += 1
                log_audit_event(
                    action="return",
                    actor_user_id=actor_user_id,
                    target_user_id=linked_req.requested_by,
                    asset_id=asset.id,
                    asset_tag=asset.tag,
                    extra={
                        "event_type": "fr18_repaired_asset_available_for_manual_assign",
                        "replacement_request_id": linked_req.id,
                    },
                )

            # 3. Mark the replacement request COMPLETED
            linked_req.status = ReplacementStatus.COMPLETED
        else:
            if asset is not None:
                asset.status = AssetStatus.AVAILABLE
                asset.version += 1

        self.db.flush()
        self.db.refresh(record)
        logger.info(
            "Closed maintenance record id=%s asset_id=%s actor_user_id=%s",
            record.id,
            record.asset_id,
            actor_user_id,
        )
        return self._to_response(record)
