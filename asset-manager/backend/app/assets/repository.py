from datetime import date
from decimal import Decimal
import re
from sqlalchemy import asc, desc, func, or_, select, text
from sqlalchemy.orm import Session

from app.assets.models import Asset
from app.assignments.models import Assignment
from app.categories.models import Category
from app.common.enums import AssetStatus
from app.users.models import User


CATEGORY_CODE_MAP: dict[str, str] = {
    "laptop": "LPT",
    "monitor": "MON",
    "phone": "PHN",
    "furniture": "FRN",
    "tablet": "TBL",
    "server": "SRV",
    "network": "NET",
    "accessory": "ACC",
    "printer": "PRT",
    "audio": "AUD",
}


def derive_category_code(category_name: str) -> str:
    """Derive a 3-character uppercase category code (e.g., Laptop -> LPT)."""
    cleaned = category_name.strip().lower()
    if cleaned in CATEGORY_CODE_MAP:
        return CATEGORY_CODE_MAP[cleaned]

    alnum = re.sub(r"[^A-Z0-9]", "", category_name.upper())
    if not alnum:
        return "GEN"

    consonants = alnum[0] + "".join(c for c in alnum[1:] if c not in "AEIOU")
    code = (consonants if len(consonants) >= 3 else alnum)[:3]
    return code.ljust(3, "X")


def derive_item_hex_code(asset_name: str, category_id: int) -> str:
    """
    Build a 4-character alphanumeric + hexadecimal item code (<2-char initials><2-char hex byte>):
      - First 2 chars: Item initials extracted from asset_name words (e.g. 'MacBook Pro' -> 'MP')
      - High hex nibble: (category_id & 0x0F) in uppercase hex (0-F)
      - Low hex nibble: Deterministic 4-bit checksum of normalized asset name in uppercase hex (0-F)
    """
    tokens = re.findall(r"[A-Z0-9]+", asset_name.upper())
    if len(tokens) >= 2:
        initials = tokens[0][0] + tokens[1][0]
    elif len(tokens) == 1:
        initials = tokens[0][:2].ljust(2, "X")
    else:
        initials = "AS"

    joined = "".join(tokens)
    cat_nibble = category_id & 0x0F
    model_nibble = sum(ord(c) for c in joined) & 0x0F
    return f"{initials}{cat_nibble:X}{model_nibble:X}"


def format_asset_tag(
    category_name: str,
    category_id: int,
    asset_name: str,
    seq_val: int,
) -> str:
    """Format Option 1 Asset Tag: TEK-<CAT>-<ITEM_HEX>-<SEQ_HEX4> (e.g. TEK-LPT-MP15-0001)."""
    cat_code = derive_category_code(category_name)
    item_code = derive_item_hex_code(asset_name, category_id)
    return f"TEK-{cat_code}-{item_code}-{seq_val:04X}"


class AssetRepository:
    SORTABLE_COLUMNS = {
        "id": Asset.id,
        "tag": Asset.tag,
        "name": Asset.name,
        "serial_no": Asset.serial_no,
        "service_tag": Asset.service_tag,
        "asset_tag": Asset.asset_tag,
        "category_id": Asset.category_id,
        "purchase_date": Asset.purchase_date,
        "cost": Asset.cost,
        "location": Asset.location,
        "status": Asset.status,
        "created_at": Asset.created_at,
    }

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, asset_id: int) -> Asset | None:
        return self.db.get(Asset, asset_id)

    def get_by_serial_no(self, serial_no: str) -> Asset | None:
        normalized = serial_no.strip().lower()
        if not normalized:
            return None
        stmt = select(Asset).where(func.lower(Asset.serial_no) == normalized)
        return self.db.scalar(stmt)

    def get_by_tag(self, tag: str) -> Asset | None:
        normalized = tag.strip().upper()
        stmt = select(Asset).where(func.upper(Asset.tag) == normalized)
        return self.db.scalar(stmt)

    def get_by_service_tag(self, service_tag: str) -> Asset | None:
        normalized = service_tag.strip().lower()
        if not normalized:
            return None
        stmt = select(Asset).where(func.lower(Asset.service_tag) == normalized)
        return self.db.scalar(stmt)

    def get_by_asset_tag(self, asset_tag: str) -> Asset | None:
        normalized = asset_tag.strip().lower()
        if not normalized:
            return None
        stmt = select(Asset).where(func.lower(Asset.asset_tag) == normalized)
        return self.db.scalar(stmt)

    def generate_next_tag(
        self,
        category_name: str = "Asset",
        category_id: int = 1,
        asset_name: str = "Asset",
    ) -> str:
        bind = self.db.get_bind()
        if bind.dialect.name == "postgresql":
            seq_val = int(
                self.db.execute(text("SELECT nextval('ams_asset_tag_seq')")).scalar_one()
            )
            return format_asset_tag(
                category_name=category_name,
                category_id=category_id,
                asset_name=asset_name,
                seq_val=seq_val,
            )

        existing_tags = list(self.db.scalars(select(Asset.tag)).all())
        max_num = 0
        for tag in existing_tags:
            hex_match = re.match(
                r"^TEK-[A-Z0-9]{3}-[A-Z0-9]{4}-([0-9A-F]+)$",
                tag,
                re.IGNORECASE,
            )
            if hex_match:
                max_num = max(max_num, int(hex_match.group(1), 16))
                continue
            legacy_match = re.match(r"^AST-(\d+)$", tag, re.IGNORECASE)
            if legacy_match:
                max_num = max(max_num, int(legacy_match.group(1), 10))
        next_num = max_num + 1
        return format_asset_tag(
            category_name=category_name,
            category_id=category_id,
            asset_name=asset_name,
            seq_val=next_num,
        )

    def list_assets(
        self,
        page: int = 1,
        size: int = 20,
        sort: str = "id,asc",
        search: str | None = None,
        category_id: int | None = None,
        category_name: str | None = None,
        status: AssetStatus | None = None,
    ) -> tuple[list[Asset], int]:
        stmt = select(Asset)
        count_stmt = select(func.count()).select_from(Asset)

        if search and search.strip():
            term = f"%{search.strip().lower()}%"
            assignee_match = (
                select(Assignment.id)
                .join(User, Assignment.user_id == User.id)
                .where(
                    Assignment.asset_id == Asset.id,
                    Assignment.returned_on.is_(None),
                    func.lower(User.name).like(term),
                )
                .exists()
            )
            condition = or_(
                func.lower(Asset.name).like(term),
                func.lower(Asset.tag).like(term),
                func.lower(Asset.service_tag).like(term),
                func.lower(Asset.asset_tag).like(term),
                func.lower(Asset.serial_no).like(term),
                assignee_match,
            )
            stmt = stmt.where(condition)
            count_stmt = count_stmt.where(condition)

        if category_id is not None:
            stmt = stmt.where(Asset.category_id == category_id)
            count_stmt = count_stmt.where(Asset.category_id == category_id)
        elif category_name and category_name.strip():
            normalized_cat = category_name.strip().lower()
            stmt = stmt.join(Category, Asset.category_id == Category.id).where(
                func.lower(Category.name) == normalized_cat
            )
            count_stmt = count_stmt.join(Category, Asset.category_id == Category.id).where(
                func.lower(Category.name) == normalized_cat
            )

        if status is not None:
            stmt = stmt.where(Asset.status == status)
            count_stmt = count_stmt.where(Asset.status == status)

        parts = [p.strip() for p in sort.split(",") if p.strip()]
        sort_field = parts[0] if parts else "id"
        sort_dir = parts[1].lower() if len(parts) > 1 else "asc"
        column = self.SORTABLE_COLUMNS.get(sort_field, Asset.id)
        order_expr = desc(column) if sort_dir == "desc" else asc(column)

        stmt = stmt.order_by(order_expr, asc(Asset.id))
        stmt = stmt.offset((page - 1) * size).limit(size)

        total = int(self.db.scalar(count_stmt) or 0)
        items = list(self.db.scalars(stmt).all())
        return items, total

    def list_available_by_category(self, category_id: int) -> list[Asset]:
        """AVAILABLE assets in a category (for approve-and-assign)."""
        stmt = (
            select(Asset)
            .where(
                Asset.category_id == category_id,
                Asset.status == AssetStatus.AVAILABLE,
            )
            .order_by(asc(Asset.tag))
        )
        return list(self.db.scalars(stmt).all())

    def create(
        self,
        tag: str,
        name: str,
        serial_no: str,
        service_tag: str | None,
        asset_tag: str | None,
        category_id: int,
        purchase_date: date,
        cost: Decimal,
        location: str,
        awaiting_employee_details: bool = False,
    ) -> Asset:
        asset = Asset(
            tag=tag,
            name=name.strip(),
            serial_no=serial_no.strip(),
            service_tag=service_tag.strip() if service_tag else None,
            asset_tag=asset_tag.strip() if asset_tag else None,
            category_id=category_id,
            purchase_date=purchase_date,
            cost=cost,
            location=location.strip(),
            status=AssetStatus.AVAILABLE,
            awaiting_employee_details=awaiting_employee_details,
            version=1,
        )
        self.db.add(asset)
        self.db.flush()
        self.db.refresh(asset)
        return asset
