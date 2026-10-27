from datetime import date
from decimal import Decimal
from pathlib import Path
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.assets.models import Asset
from app.assignments.models import Assignment
from app.categories.models import Category
from app.common.enums import AssetStatus, ReturnReason, UserRole
from app.users.models import User


def assert_error_contract(payload: dict, expected_status: int) -> None:
    # TT Suite adds an optional machine-readable `code` (e.g. NO_APP_ACCESS)
    assert {"status", "message", "timestamp"} <= set(payload.keys()) <= {"status", "message", "timestamp", "code"}
    assert payload["status"] == expected_status
    assert isinstance(payload["message"], str) and len(payload["message"]) > 0
    assert isinstance(payload["timestamp"], str) and "T" in payload["timestamp"]


def test_all_six_tables_created(db_session: Session) -> None:
    inspector = inspect(db_session.get_bind())
    table_names = set(inspector.get_table_names())
    expected_tables = {
        "ams_users",
        "ams_categories",
        "ams_assets",
        "ams_assignments",
        "ams_maintenance_records",
        "ams_replacement_requests",
        "ams_asset_requests",
    }
    assert expected_tables.issubset(table_names)


def test_default_seed_users_and_categories(db_session: Session) -> None:
    users = list(db_session.scalars(select(User).order_by(User.id)).all())
    assert len(users) == 3

    roles_by_email = {u.email: u.role for u in users}
    assert roles_by_email["admin@tektalis.com"] == UserRole.ADMIN
    assert roles_by_email["manager@tektalis.com"] == UserRole.ASSET_MANAGER
    assert roles_by_email["employee@tektalis.com"] == UserRole.EMPLOYEE

    categories = list(db_session.scalars(select(Category).order_by(Category.id)).all())
    category_names = [c.name for c in categories]
    assert category_names == ["Laptop", "Monitor", "Phone", "Furniture"]


def test_partial_unique_index_on_open_assignments(db_session: Session) -> None:
    category = db_session.scalar(select(Category).where(Category.name == "Laptop"))
    employee = db_session.scalar(select(User).where(User.email == "employee@tektalis.com"))
    manager = db_session.scalar(select(User).where(User.email == "manager@tektalis.com"))
    assert category is not None and employee is not None and manager is not None

    asset = Asset(
        tag="AST-0001",
        name="ThinkPad X1 Carbon",
        serial_no="SN-X1-0001",
        service_tag="SVC-X1-0001",
        asset_tag="ATG-X1-0001",
        category_id=category.id,
        purchase_date=date(2026, 1, 15),
        cost=Decimal("1899.99"),
        location="HQ - Floor 3",
        status=AssetStatus.ASSIGNED,
    )
    db_session.add(asset)
    db_session.commit()

    # First closed assignment
    closed_assignment = Assignment(
        asset_id=asset.id,
        user_id=employee.id,
        assigned_on=date(2026, 2, 1),
        returned_on=date(2026, 3, 1),
        return_reason=ReturnReason.OTHER,
    )
    db_session.add(closed_assignment)
    db_session.commit()

    # First open assignment succeeds
    open_assignment_1 = Assignment(
        asset_id=asset.id,
        user_id=employee.id,
        assigned_on=date(2026, 3, 2),
        returned_on=None,
    )
    db_session.add(open_assignment_1)
    db_session.commit()

    # Second simultaneous open assignment for the same asset must violate partial unique index
    open_assignment_2 = Assignment(
        asset_id=asset.id,
        user_id=manager.id,
        assigned_on=date(2026, 3, 5),
        returned_on=None,
    )
    db_session.add(open_assignment_2)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_alembic_migration_upgrade_and_downgrade(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_file = tmp_path / "alembic_test.sqlite3"
    db_url = f"sqlite:///{db_file.as_posix()}"

    from app.common.config import settings

    monkeypatch.setattr(settings, "DATABASE_URL", db_url)

    backend_dir = Path(__file__).resolve().parents[1]
    alembic_cfg = Config(str(backend_dir / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", db_url)

    command.upgrade(alembic_cfg, "head")
    command.downgrade(alembic_cfg, "base")
    command.upgrade(alembic_cfg, "head")
