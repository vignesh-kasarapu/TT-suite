from datetime import datetime
from sqlalchemy import Boolean, DateTime, Enum as SqlEnum, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.common.database import Base, BigIntPK
from app.common.enums import UserRole


class User(Base):
    __tablename__ = "ams_users"

    id: Mapped[int] = mapped_column(BigIntPK, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    # TT Suite: sign-in is the portal's; the hash is kept for history only (new users have none).
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # The person's app.users.id in the TT Suite (filled on first visit or by the global admin).
    suite_user_id: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True)
    role: Mapped[UserRole] = mapped_column(
        SqlEnum(UserRole, native_enum=False, length=50),
        nullable=False,
        default=UserRole.EMPLOYEE,
    )
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default=text("true"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
