from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, DateTime, Enum as SqlEnum, ForeignKey, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.assets.models import Asset
from app.common.database import Base, BigIntPK
from app.common.enums import OldAssetAction, ReplacementStatus
from app.users.models import User


class ReplacementRequest(Base):
    __tablename__ = "ams_replacement_requests"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    asset_id: Mapped[int] = mapped_column(
        BigIntPK,
        ForeignKey("ams_assets.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    requested_by: Mapped[int] = mapped_column(
        BigIntPK,
        ForeignKey("ams_users.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    old_asset_action: Mapped[OldAssetAction] = mapped_column(
        SqlEnum(OldAssetAction, native_enum=False, length=50),
        nullable=False,
    )
    temporary: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    replacement_asset_id: Mapped[Optional[int]] = mapped_column(
        BigIntPK,
        ForeignKey("ams_assets.id", ondelete="RESTRICT"),
        nullable=True,
    )
    status: Mapped[ReplacementStatus] = mapped_column(
        SqlEnum(ReplacementStatus, native_enum=False, length=50),
        index=True,
        nullable=False,
        default=ReplacementStatus.PENDING,
    )
    decided_by: Mapped[Optional[int]] = mapped_column(
        BigIntPK,
        ForeignKey("ams_users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    decision_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    asset_rel: Mapped[Asset] = relationship(
        "Asset",
        foreign_keys=[asset_id],
        lazy="joined",
    )
    replacement_asset_rel: Mapped[Optional[Asset]] = relationship(
        "Asset",
        foreign_keys=[replacement_asset_id],
        lazy="joined",
    )
    requester_rel: Mapped[User] = relationship(
        "User",
        foreign_keys=[requested_by],
        lazy="joined",
    )
    decider_rel: Mapped[Optional[User]] = relationship(
        "User",
        foreign_keys=[decided_by],
        lazy="joined",
    )

    @property
    def asset_tag(self) -> str | None:
        return self.asset_rel.tag if self.asset_rel is not None else None

    @property
    def asset_name(self) -> str | None:
        return self.asset_rel.name if self.asset_rel is not None else None

    @property
    def asset_category_id(self) -> int | None:
        return self.asset_rel.category_id if self.asset_rel is not None else None

    @property
    def asset_category_name(self) -> str | None:
        if self.asset_rel is None:
            return None
        return self.asset_rel.category_name

    @property
    def replacement_asset_tag(self) -> str | None:
        return (
            self.replacement_asset_rel.tag
            if self.replacement_asset_rel is not None
            else None
        )

    @property
    def replacement_asset_name(self) -> str | None:
        return (
            self.replacement_asset_rel.name
            if self.replacement_asset_rel is not None
            else None
        )

    @property
    def requester_name(self) -> str | None:
        return self.requester_rel.name if self.requester_rel is not None else None

    @property
    def requester_email(self) -> str | None:
        return self.requester_rel.email if self.requester_rel is not None else None

    @property
    def decider_name(self) -> str | None:
        return self.decider_rel.name if self.decider_rel is not None else None

    @property
    def decider_email(self) -> str | None:
        return self.decider_rel.email if self.decider_rel is not None else None
