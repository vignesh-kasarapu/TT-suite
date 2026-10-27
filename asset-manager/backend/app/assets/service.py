from datetime import date
from decimal import Decimal, InvalidOperation
import logging
import math
import re
from sqlalchemy.orm import Session

from app.assets.models import Asset
from app.assets.repository import AssetRepository
from app.assets.schemas import (
    AssetBulkImportResponse,
    AssetCreateRequest,
    AssetImportRowError,
    AssetResponse,
    AssetUpdateRequest,
    PaginatedAssetsResponse,
)
from app.assignments.repository import AssignmentRepository
from app.categories.repository import CategoryRepository
from app.common.audit import log_audit_event
from app.common.database import transactional
from app.common.enums import AssetStatus
from app.common.excel import (
    build_xlsx_bytes,
    decode_excel_base64,
    parse_excel_or_iso_date,
    parse_tabular_text,
    parse_xlsx_bytes,
)
from app.common.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
)
from app.users.repository import UserRepository

logger = logging.getLogger("ams.assets")


class AssetService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repository = AssetRepository(db)
        self.category_repository = CategoryRepository(db)
        self.user_repository = UserRepository(db)
        self.assignment_repository = AssignmentRepository(db)

    def _assigned_to_name(self, asset_id: int) -> str | None:
        open_assignment = self.assignment_repository.get_open_assignment_for_asset(
            asset_id
        )
        if open_assignment is None:
            return None
        return open_assignment.user_name

    def _to_asset_response(
        self,
        asset: Asset,
        assigned_to_name: str | None = None,
        *,
        resolve_assignee: bool = False,
    ) -> AssetResponse:
        name = assigned_to_name
        if resolve_assignee:
            name = self._assigned_to_name(asset.id)
        response = AssetResponse.model_validate(asset)
        return response.model_copy(update={"assigned_to_name": name})

    def _resolve_category_id(
        self,
        category_id: int | None,
        category_value: int | str | None,
        required: bool = True,
    ) -> int | None:
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
                    raise NotFoundException(f"Category '{category_value.strip()}' not found")
                return cat.id

        if required:
            raise BadRequestException("category_id is required")
        return None

    def list_assets(
        self,
        page: int = 1,
        size: int = 20,
        sort: str = "id,asc",
        search: str | None = None,
        category: str | None = None,
        category_id: int | None = None,
        status: AssetStatus | None = None,
    ) -> PaginatedAssetsResponse:
        if page < 1 or size < 1:
            raise BadRequestException("Pagination parameters page and size must be >= 1")

        resolved_category_id = category_id
        resolved_category_name: str | None = None

        if resolved_category_id is None and category and category.strip():
            cleaned_cat = category.strip()
            if cleaned_cat.isdigit():
                resolved_category_id = int(cleaned_cat)
            else:
                resolved_category_name = cleaned_cat

        items, total = self.repository.list_assets(
            page=page,
            size=size,
            sort=sort,
            search=search,
            category_id=resolved_category_id,
            category_name=resolved_category_name,
            status=status,
        )
        pages = math.ceil(total / size) if total > 0 else 1
        assignee_names = self.assignment_repository.get_open_assignee_names(
            [asset.id for asset in items]
        )
        return PaginatedAssetsResponse(
            items=[
                self._to_asset_response(asset, assignee_names.get(asset.id))
                for asset in items
            ],
            total=total,
            page=page,
            size=size,
            pages=pages,
        )

    def get_asset(self, asset_id: int) -> AssetResponse:
        asset = self.repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")
        return self._to_asset_response(asset, resolve_assignee=True)

    @transactional
    def create_asset(self, payload: AssetCreateRequest) -> AssetResponse:
        resolved_category_id = self._resolve_category_id(
            category_id=payload.category_id,
            category_value=payload.category,
            required=True,
        )
        assert resolved_category_id is not None

        existing_serial = self.repository.get_by_serial_no(payload.serial_no)
        if existing_serial is not None:
            raise ConflictException(
                f"Asset with serial_no '{payload.serial_no.strip()}' already exists"
            )

        if payload.service_tag:
            existing_service = self.repository.get_by_service_tag(payload.service_tag)
            if existing_service is not None:
                raise ConflictException(
                    f"Asset with service_tag '{payload.service_tag.strip()}' already exists"
                )

        if payload.asset_tag:
            existing_asset_tag = self.repository.get_by_asset_tag(payload.asset_tag)
            if existing_asset_tag is not None:
                raise ConflictException(
                    f"Asset with asset_tag '{payload.asset_tag.strip()}' already exists"
                )

        category_obj = self.category_repository.get_by_id(resolved_category_id)
        category_name = category_obj.name if category_obj is not None else "Asset"

        tag = self.repository.generate_next_tag(
            category_name=category_name,
            category_id=resolved_category_id,
            asset_name=payload.name,
        )
        asset = self.repository.create(
            tag=tag,
            name=payload.name,
            serial_no=payload.serial_no,
            service_tag=payload.service_tag,
            asset_tag=payload.asset_tag,
            category_id=resolved_category_id,
            purchase_date=payload.purchase_date,
            cost=payload.cost,
            location=payload.location,
        )
        logger.info(
            "Created asset id=%s tag=%s serial_no=%s status=%s",
            asset.id,
            asset.tag,
            asset.serial_no,
            asset.status.value,
        )
        return self._to_asset_response(asset)

    @transactional
    def update_asset(self, asset_id: int, payload: AssetUpdateRequest) -> AssetResponse:
        asset: Asset | None = self.repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")

        if asset.status == AssetStatus.RETIRED:
            raise ConflictException(
                f"Cannot edit asset '{asset.tag}' because it is RETIRED"
            )
        if asset.status == AssetStatus.ASSIGNED:
            raise ConflictException(
                f"Cannot edit asset '{asset.tag}' while it is ASSIGNED"
            )

        if payload.tag is not None:
            raise ConflictException("Asset ID is immutable and cannot be modified")

        update_fields = payload.model_dump(exclude_unset=True)

        if "serial_no" in update_fields:
            serial_value = update_fields["serial_no"]
            if not serial_value:
                raise ConflictException("Serial number is required and cannot be blank")
            existing_serial = self.repository.get_by_serial_no(serial_value)
            if existing_serial is not None and existing_serial.id != asset.id:
                raise ConflictException(
                    f"Asset with serial_no '{serial_value.strip()}' already exists"
                )
            asset.serial_no = serial_value

        if "service_tag" in update_fields:
            service_value = update_fields["service_tag"]
            if service_value:
                existing_service = self.repository.get_by_service_tag(service_value)
                if existing_service is not None and existing_service.id != asset.id:
                    raise ConflictException(
                        f"Asset with service_tag '{service_value.strip()}' already exists"
                    )
            asset.service_tag = service_value

        if "asset_tag" in update_fields:
            asset_tag_value = update_fields["asset_tag"]
            if asset_tag_value:
                existing_asset_tag = self.repository.get_by_asset_tag(asset_tag_value)
                if existing_asset_tag is not None and existing_asset_tag.id != asset.id:
                    raise ConflictException(
                        f"Asset with asset_tag '{asset_tag_value.strip()}' already exists"
                    )
            asset.asset_tag = asset_tag_value

        resolved_category_id = self._resolve_category_id(
            category_id=payload.category_id,
            category_value=payload.category,
            required=False,
        )
        if resolved_category_id is not None:
            asset.category_id = resolved_category_id

        if payload.name is not None:
            asset.name = payload.name

        if payload.purchase_date is not None:
            asset.purchase_date = payload.purchase_date

        if payload.cost is not None:
            asset.cost = payload.cost

        if payload.location is not None:
            asset.location = payload.location

        asset.version += 1
        self.db.flush()
        self.db.refresh(asset)
        logger.info(
            "Updated asset id=%s tag=%s version=%s",
            asset.id,
            asset.tag,
            asset.version,
        )
        return self._to_asset_response(asset, resolve_assignee=True)

    @transactional
    def retire_asset(self, asset_id: int, actor_user_id: int) -> AssetResponse:
        asset: Asset | None = self.repository.get_by_id(asset_id)
        if asset is None:
            raise NotFoundException(f"Asset with id {asset_id} not found")

        if asset.status == AssetStatus.RETIRED:
            raise ConflictException(f"Asset '{asset.tag}' is already RETIRED")

        if asset.status == AssetStatus.ASSIGNED:
            raise ConflictException(
                f"Cannot retire asset '{asset.tag}' while it is ASSIGNED; return it first"
            )

        if asset.status != AssetStatus.AVAILABLE:
            raise ConflictException(
                f"Cannot retire asset '{asset.tag}' while status is {asset.status.value}; only AVAILABLE assets can be retired"
            )

        asset.status = AssetStatus.RETIRED
        asset.version += 1
        self.db.flush()
        self.db.refresh(asset)

        log_audit_event(
            action="retire",
            actor_user_id=actor_user_id,
            asset_id=asset.id,
            asset_tag=asset.tag,
        )
        return self._to_asset_response(asset)

    ASSETS_TEMPLATE_HEADERS = [
        "name",
        "serial_no",
        "service_tag",
        "asset_tag",
        "category",
        "purchase_date",
        "cost",
        "location",
        "assigned_to_email",
    ]
    ASSETS_TEMPLATE_SAMPLE_ROWS = [
        [
            "MacBook Pro 16 M4",
            "SN-MBP-9001",
            "SVC-MBP-9001",
            "TEK-MBP-14",
            "Laptop",
            "2026-03-15",
            "195000.00",
            "Hyderabad - Floor 14",
            "employee@tektalis.com",
        ],
        [
            "Dell UltraSharp 27 4K",
            "SN-MON-9002",
            "SVC-MON-9002",
            "TEK-MON-27",
            "Monitor",
            "2026-03-18",
            "48500.00",
            "Hyderabad - Floor 14",
            "",
        ],
        [
            "CalDigit TS4 Dock",
            "SN-DCK-9003",
            "SVC-DCK-9003",
            "TEK-DCK-TS4",
            "Docking Station",
            "2026-03-20",
            "32000.00",
            "Bengaluru - Floor 5",
            "",
        ],
    ]

    def generate_assets_excel_template(self) -> bytes:
        return build_xlsx_bytes(
            headers=self.ASSETS_TEMPLATE_HEADERS,
            rows=self.ASSETS_TEMPLATE_SAMPLE_ROWS,
            sheet_name="AssetsImport",
        )

    @staticmethod
    def _parse_csv_date(raw_date: str) -> date:
        return parse_excel_or_iso_date(raw_date)

    @staticmethod
    def _parse_csv_cost(raw_cost: str) -> Decimal:
        cleaned = re.sub(r"[₹$,\s]", "", raw_cost.strip())
        if not cleaned:
            raise ValueError("Cost cannot be blank")
        try:
            value = Decimal(cleaned)
        except InvalidOperation as exc:
            raise ValueError(f"Invalid cost '{raw_cost}'. Must be a valid number") from exc
        if value < Decimal("0.00"):
            raise ValueError("Cost must be >= 0.00")
        return value.quantize(Decimal("0.01"))

    @transactional
    def import_assets_data(
        self,
        actor_user_id: int,
        excel_base64: str | None = None,
        csv_content: str | None = None,
    ) -> AssetBulkImportResponse:
        if excel_base64 and excel_base64.strip():
            xlsx_bytes = decode_excel_base64(excel_base64)
            normalized_headers, parsed_rows = parse_xlsx_bytes(xlsx_bytes)
        elif csv_content and csv_content.strip():
            normalized_headers, parsed_rows = parse_tabular_text(csv_content)
        else:
            raise BadRequestException(
                "Please provide an Excel (.xlsx) file or tabular import rows"
            )

        required_headers = {
            "name",
            "serial_no",
            "category",
            "purchase_date",
            "cost",
            "location",
        }
        missing_headers = required_headers - set(normalized_headers)
        if missing_headers:
            raise BadRequestException(
                f"Missing required column header(s): {', '.join(sorted(missing_headers))}. "
                "Required headers: name, serial_no, category, purchase_date, cost, location. "
                "Optional: service_tag, asset_tag, assigned_to_email"
            )

        total_rows = 0
        created_categories: list[str] = []
        imported_items: list[AssetResponse] = []
        errors: list[AssetImportRowError] = []

        for row_num, row_map in enumerate(parsed_rows, start=2):
            if not any(row_map.values()):
                continue

            total_rows += 1
            raw_name = row_map.get("name", "")
            raw_serial_no = row_map.get("serial_no", "")
            raw_service_tag = row_map.get("service_tag", "")
            raw_asset_tag = row_map.get("asset_tag", "")
            raw_category = row_map.get("category", "")
            raw_purchase_date = row_map.get("purchase_date", "")
            raw_cost = row_map.get("cost", "")
            raw_location = row_map.get("location", "")
            raw_assigned_email = row_map.get("assigned_to_email", "").lower()

            identifier = raw_serial_no or raw_name or f"Row {row_num}"

            try:
                with self.db.begin_nested():
                    if not raw_name:
                        raise ValueError("Asset name cannot be blank")
                    if len(raw_name) > 255:
                        raise ValueError("Asset name cannot exceed 255 characters")

                    if not raw_serial_no:
                        raise ValueError("serial_no cannot be blank")
                    if len(raw_serial_no) > 255:
                        raise ValueError("serial_no cannot exceed 255 characters")
                    if len(raw_service_tag) > 255:
                        raise ValueError("service_tag cannot exceed 255 characters")
                    if len(raw_asset_tag) > 255:
                        raise ValueError("asset_tag cannot exceed 255 characters")

                    if not raw_category:
                        raise ValueError("Category cannot be blank")
                    if len(raw_category) > 100:
                        raise ValueError("Category name cannot exceed 100 characters")

                    if not raw_location:
                        raise ValueError("Location cannot be blank")
                    if len(raw_location) > 255:
                        raise ValueError("Location cannot exceed 255 characters")

                    existing_serial = self.repository.get_by_serial_no(raw_serial_no)
                    if existing_serial is not None:
                        raise ValueError(
                            f"Asset with serial_no '{raw_serial_no}' already exists"
                        )

                    if raw_service_tag:
                        existing_service = self.repository.get_by_service_tag(
                            raw_service_tag
                        )
                        if existing_service is not None:
                            raise ValueError(
                                f"Asset with service_tag '{raw_service_tag}' already exists"
                            )

                    if raw_asset_tag:
                        existing_asset_tag = self.repository.get_by_asset_tag(
                            raw_asset_tag
                        )
                        if existing_asset_tag is not None:
                            raise ValueError(
                                f"Asset with asset_tag '{raw_asset_tag}' already exists"
                            )

                    parsed_date = self._parse_csv_date(raw_purchase_date)
                    parsed_cost = self._parse_csv_cost(raw_cost)

                    assignee = None
                    if raw_assigned_email:
                        assignee = self.user_repository.get_by_email(raw_assigned_email)
                        if assignee is None:
                            raise ValueError(
                                f"Assigned user '{raw_assigned_email}' not found"
                            )
                        if not assignee.active:
                            raise ValueError(
                                f"Cannot assign asset to inactive user '{raw_assigned_email}'"
                            )

                    cat = self.category_repository.get_by_name(raw_category)
                    new_category_created: str | None = None
                    if cat is None:
                        cat = self.category_repository.create(name=raw_category)
                        new_category_created = cat.name

                    tag = self.repository.generate_next_tag(
                        category_name=cat.name,
                        category_id=cat.id,
                        asset_name=raw_name,
                    )
                    asset = self.repository.create(
                        tag=tag,
                        name=raw_name,
                        serial_no=raw_serial_no,
                        service_tag=raw_service_tag or None,
                        asset_tag=raw_asset_tag or None,
                        category_id=cat.id,
                        purchase_date=parsed_date,
                        cost=parsed_cost,
                        location=raw_location,
                    )

                    if assignee is not None:
                        asset.status = AssetStatus.ASSIGNED
                        self.db.flush()
                        self.assignment_repository.create(
                            asset_id=asset.id,
                            user_id=assignee.id,
                            assigned_on=date.today(),
                        )
                        self.db.refresh(asset)
                        log_audit_event(
                            action="assign",
                            actor_user_id=actor_user_id,
                            asset_id=asset.id,
                            asset_tag=asset.tag,
                            target_user_id=assignee.id,
                        )

                    if (
                        new_category_created
                        and new_category_created not in created_categories
                    ):
                        created_categories.append(new_category_created)

                    assigned_name = assignee.name if assignee is not None else None
                    imported_items.append(
                        self._to_asset_response(asset, assigned_name)
                    )
            except Exception as exc:
                errors.append(
                    AssetImportRowError(
                        row=row_num,
                        identifier=identifier,
                        message=str(exc),
                    )
                )

        if total_rows == 0:
            raise BadRequestException("Excel file contains no data rows to import")

        logger.info(
            "Bulk imported assets total_rows=%s imported=%s skipped=%s new_categories=%s",
            total_rows,
            len(imported_items),
            len(errors),
            created_categories,
        )
        return AssetBulkImportResponse(
            total_rows=total_rows,
            imported_count=len(imported_items),
            skipped_count=len(errors),
            created_categories=created_categories,
            imported_items=imported_items,
            errors=errors,
        )

    def import_assets_csv(
        self,
        csv_content: str,
        actor_user_id: int,
    ) -> AssetBulkImportResponse:
        return self.import_assets_data(
            actor_user_id=actor_user_id,
            csv_content=csv_content,
        )

