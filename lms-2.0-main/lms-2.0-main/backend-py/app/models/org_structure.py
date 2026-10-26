"""Small reference-data tables with no timestamps (Sequelize `timestamps: false`),
except ProjectAssignment (created_at only) and EmployeeRole (its own assigned_at)."""
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.mixins import CreatedAtMixin


class Department(Base):
    __tablename__ = "departments"

    department_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    department_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    department_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Region(Base):
    __tablename__ = "regions"

    region_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    region_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    region_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Grade(Base):
    __tablename__ = "grades"

    grade_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    grade_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    grade_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ManagementLevel(Base):
    __tablename__ = "management_levels"

    management_level_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    level_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    level_name: Mapped[str] = mapped_column(String(100), nullable=False)
    level_rank: Mapped[int] = mapped_column(unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Project(Base):
    __tablename__ = "projects"

    project_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    project_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    project_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ProjectAssignment(Base, CreatedAtMixin):
    __tablename__ = "project_assignments"

    assignment_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    project_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("projects.project_id"), nullable=False)
    # Auto-Watcher on any request overlapping the assignment span (LMS-014).
    project_lead_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)  # null = open-ended
    created_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), nullable=False)


class Role(Base):
    __tablename__ = "roles"

    role_id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=True)
    role_code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)  # EMPLOYEE|MANAGER|HR_ADMIN
    role_name: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)


class EmployeeRole(Base):
    """Join table for Employee<->Role (the only M:N relation in the whole schema)."""

    __tablename__ = "user_roles"

    employee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.user_id"), primary_key=True)
    role_id: Mapped[int] = mapped_column(SmallInteger, ForeignKey("roles.role_id"), primary_key=True)
    assigned_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())

    # Eager-loaded so EmployeeOut.from_model can report an employee's roles without a
    # session of its own; the join table is tiny and every employee read wants them.
    role: Mapped["Role"] = relationship("Role", lazy="joined")
