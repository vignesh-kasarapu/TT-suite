from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, Enum as SqlEnum, ForeignKey, Integer, Numeric, Sequence, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.categories.models import Category
from app.common.database import Base, BigIntPK
from app.common.enums import AssetStatus

asset_tag_seq = Sequence("ams_asset_tag_seq", start=1, increment=1, metadata=Base.metadata)


class Asset(Base):
    __tablename__ = "ams_assets"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    # Auto-generated immutable Asset ID (TEK-… / legacy AST-…)
    tag: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    serial_no: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    service_tag: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    asset_tag: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    category_id: Mapped[int] = mapped_column(
        BigIntPK,
        ForeignKey("ams_categories.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[AssetStatus] = mapped_column(
        SqlEnum(AssetStatus, native_enum=False, length=50),
        index=True,
        nullable=False,
        default=AssetStatus.AVAILABLE,
    )
    awaiting_employee_details: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default=text("1"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    category_rel: Mapped[Category] = relationship("Category", lazy="joined")

    @property
    def category_name(self) -> str | None:
        return self.category_rel.name if self.category_rel is not None else None
