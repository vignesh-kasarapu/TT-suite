from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import Date, DateTime, ForeignKey, Numeric, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.assets.models import Asset
from app.common.database import Base, BigIntPK
from app.users.models import User


class MaintenanceRecord(Base):
    __tablename__ = "ams_maintenance_records"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        BigIntPK,
        ForeignKey("ams_assets.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    replacement_request_id: Mapped[Optional[int]] = mapped_column(
        BigIntPK,
        ForeignKey("ams_replacement_requests.id", ondelete="SET NULL"),
        nullable=True,
    )
    opened_by: Mapped[Optional[int]] = mapped_column(
        BigIntPK,
        ForeignKey("ams_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    opened_on: Mapped[date] = mapped_column(Date, nullable=False)
    closed_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    resolution: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cost: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    asset_rel: Mapped[Asset] = relationship("Asset", lazy="joined")
    opened_by_rel: Mapped[Optional[User]] = relationship(
        "User",
        foreign_keys=[opened_by],
        lazy="joined",
    )

    @property
    def asset_tag(self) -> str | None:
        return self.asset_rel.tag if self.asset_rel is not None else None

    @property
    def asset_name(self) -> str | None:
        return self.asset_rel.name if self.asset_rel is not None else None
