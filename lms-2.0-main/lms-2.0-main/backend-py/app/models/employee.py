"""Employee -> `users` table. Mirrors backend/src/models/employee.model.js exactly,
including its two VIRTUAL (computed, non-persisted) attributes, ported here as
@hybrid_property: `full_name` (first+last, falling back to employee_code) and
`status` (derived from is_active) — neither is a real column."""
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.mixins import TimestampMixin
from app.core.db import Base


class Employee(Base, TimestampMixin):
    __tablename__ = "users"

    employee_id: Mapped[int] = mapped_column(
        "user_id", BigInteger, primary_key=True, autoincrement=True
    )
    entra_oid: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    work_email: Mapped[str] = mapped_column("email", String(255), nullable=False)
    employee_code: Mapped[str] = mapped_column(String(50), nullable=False)
    # TT Suite person id (app.users.id) — set whenever it is known (suite contract §3.3).
    suite_user_id: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    date_of_joining: Mapped[date] = mapped_column("joined_date", Date, nullable=False)

    department_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("departments.department_id"), nullable=True
    )
    grade_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("grades.grade_id"), nullable=True)
    management_level_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("management_levels.management_level_id"), nullable=True
    )
    # Region of working — filters which holidays apply to this employee.
    region_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("regions.region_id"), nullable=True)

    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 'MALE' | 'FEMALE'
    marital_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(100), nullable=True, default="Employee")

    reporting_manager_id: Mapped[int | None] = mapped_column(
        "manager_id", BigInteger, ForeignKey("users.user_id"), nullable=True
    )

    # Self-service personal details (see services/employee/update_own_profile.py's allow-list).
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    personal_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    emergency_contact_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    avatar_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deactivated_at: Mapped[datetime | None] = mapped_column("deactivated_date", DateTime, nullable=True)

    manager: Mapped["Employee | None"] = relationship(
        "Employee", remote_side=[employee_id], back_populates="direct_reports"
    )
    direct_reports: Mapped[list["Employee"]] = relationship("Employee", back_populates="manager")
    role_grants: Mapped[list["EmployeeRole"]] = relationship(
        "EmployeeRole", lazy="selectin", viewonly=True,
        primaryjoin="Employee.employee_id == foreign(EmployeeRole.employee_id)",
    )

    @hybrid_property
    def full_name(self) -> str:
        name = f"{self.first_name or ''} {self.last_name or ''}".strip()
        return name or self.employee_code

    @full_name.setter
    def full_name(self, value: str) -> None:
        parts = (value or "").strip().split(" ")
        self.first_name = parts[0] if parts else ""
        self.last_name = " ".join(parts[1:]) if len(parts) > 1 else None

    @hybrid_property
    def status(self) -> str:
        return "DEACTIVATED" if not self.is_active else "ACTIVE"

    @status.setter
    def status(self, value: str) -> None:
        self.is_active = value in ("ACTIVE", True, 1)


# PostgreSQL compares text case-sensitively (MySQL's utf8mb4_unicode_ci did not), so
# email and employee-code uniqueness is enforced on lower(...), and every lookup in
# employee_dao compares lower-cased.
Index("ux_users_email_lower", func.lower(Employee.__table__.c.email), unique=True)
Index("ux_users_employee_code_lower", func.lower(Employee.__table__.c.employee_code), unique=True)
