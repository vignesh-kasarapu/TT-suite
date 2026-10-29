from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(200))  # unused: sign-in is through the TT Suite
    suite_user_id: Mapped[str | None] = mapped_column(String(40), unique=True)  # app.users.id
    full_name: Mapped[str] = mapped_column(String(200))
    employee_code: Mapped[str] = mapped_column(String(50), unique=True)
    department: Mapped[str] = mapped_column(String(100), default="")
    location: Mapped[str] = mapped_column(String(100), default="")
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    roles: Mapped[list[str]] = mapped_column(ARRAY(String(20)), default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    phone: Mapped[str] = mapped_column(String(30), default="")
    designation: Mapped[str] = mapped_column(String(100), default="")
    # Bank details for reimbursement; employee changes wait in bank_pending until Finance verifies them
    bank_account_holder: Mapped[str] = mapped_column(String(200), default="")
    bank_account_no: Mapped[str] = mapped_column(String(30), default="")
    bank_ifsc: Mapped[str] = mapped_column(String(11), default="")
    bank_upi: Mapped[str] = mapped_column(String(100), default="")
    # none_as_null: clearing it stores SQL NULL, not a JSON null that `IS NOT NULL` would still match
    bank_pending: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    # Which events create a notification for this user: APPROVED, RETURNED, PAID, COMMENT
    notify_prefs: Mapped[dict] = mapped_column(JSONB, default=dict)
    token_version: Mapped[int] = mapped_column(Integer, default=0)  # unused since TT Suite sign-in (sessions live in app.session)
    preset: Mapped[str] = mapped_column(String(20), default="plain")  # unused: theme is the TT Suite preference
    theme_mode: Mapped[str] = mapped_column(String(20), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    manager: Mapped["User | None"] = relationship(remote_side="User.id")
