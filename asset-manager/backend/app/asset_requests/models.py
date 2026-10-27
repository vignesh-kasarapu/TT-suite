from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.assets.models import Asset
from app.categories.models import Category
from app.common.database import Base, BigIntPK
from app.common.enums import AssetRequestStatus
from app.users.models import User


class AssetRequest(Base):
    __tablename__ = "ams_asset_requests"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    requested_by: Mapped[int] = mapped_column(
        BigIntPK,
        ForeignKey("ams_users.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[Optional[int]] = mapped_column(
        BigIntPK,
        ForeignKey("ams_categories.id", ondelete="RESTRICT"),
        nullable=True,
    )
    is_other: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    other_category_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    other_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    serial_no: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    service_tag: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    asset_tag: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    purchase_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[AssetRequestStatus] = mapped_column(
        SqlEnum(AssetRequestStatus, native_enum=False, length=50),
        index=True,
        nullable=False,
        default=AssetRequestStatus.PENDING,
    )
    requires_employee_register: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    created_asset_id: Mapped[Optional[int]] = mapped_column(
        BigIntPK,
        ForeignKey("ams_assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    decided_by: Mapped[Optional[int]] = mapped_column(
        BigIntPK,
        ForeignKey("ams_users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    decision_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    requester_rel: Mapped[User] = relationship(
        "User",
        foreign_keys=[requested_by],
        lazy="joined",
    )
    category_rel: Mapped[Optional[Category]] = relationship(
        "Category",
        foreign_keys=[category_id],
        lazy="joined",
    )
    created_asset_rel: Mapped[Optional[Asset]] = relationship(
        "Asset",
        foreign_keys=[created_asset_id],
        lazy="joined",
    )
    decider_rel: Mapped[Optional[User]] = relationship(
        "User",
        foreign_keys=[decided_by],
        lazy="joined",
    )

    @property
    def requester_name(self) -> str | None:
        return self.requester_rel.name if self.requester_rel is not None else None

    @property
    def requester_email(self) -> str | None:
        return self.requester_rel.email if self.requester_rel is not None else None

    @property
    def category_name(self) -> str | None:
        if self.is_other:
            return self.other_category_name
        return self.category_rel.name if self.category_rel is not None else None

    @property
    def created_asset_tag(self) -> str | None:
        return (
            self.created_asset_rel.tag if self.created_asset_rel is not None else None
        )

    @property
    def decider_name(self) -> str | None:
        return self.decider_rel.name if self.decider_rel is not None else None

    @property
    def decider_email(self) -> str | None:
        return self.decider_rel.email if self.decider_rel is not None else None
