from datetime import date, datetime
from typing import Optional
from sqlalchemy import Date, DateTime, Enum as SqlEnum, ForeignKey, Index, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.assets.models import Asset
from app.common.database import Base, BigIntPK
from app.common.enums import ReturnReason
from app.users.models import User


class Assignment(Base):
    __tablename__ = "ams_assignments"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        BigIntPK,
        ForeignKey("ams_assets.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        BigIntPK,
        ForeignKey("ams_users.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    assigned_on: Mapped[date] = mapped_column(Date, nullable=False)
    returned_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    return_reason: Mapped[Optional[ReturnReason]] = mapped_column(
        SqlEnum(ReturnReason, native_enum=False, length=50),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    asset_rel: Mapped[Asset] = relationship("Asset", lazy="joined")
    user_rel: Mapped[User] = relationship("User", lazy="joined")

    @property
    def user_name(self) -> str | None:
        return self.user_rel.name if self.user_rel is not None else None

    @property
    def user_email(self) -> str | None:
        return self.user_rel.email if self.user_rel is not None else None

    @property
    def asset_tag(self) -> str | None:
        return self.asset_rel.tag if self.asset_rel is not None else None

    @property
    def asset_name(self) -> str | None:
        return self.asset_rel.name if self.asset_rel is not None else None

    __table_args__ = (
        Index(
            "uq_ams_assignments_open_asset",
            "asset_id",
            unique=True,
            postgresql_where=text("returned_on IS NULL"),
            sqlite_where=text("returned_on IS NULL"),
        ),
    )
