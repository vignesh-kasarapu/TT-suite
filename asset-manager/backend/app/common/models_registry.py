"""Central registry of all SQLAlchemy models for Alembic and metadata initialization."""
from app.common.database import Base
from app.users.models import User
from app.categories.models import Category
from app.assets.models import Asset, asset_tag_seq
from app.assignments.models import Assignment
from app.replacements.models import ReplacementRequest
from app.maintenance.models import MaintenanceRecord
from app.asset_requests.models import AssetRequest

__all__ = [
    "Base",
    "User",
    "Category",
    "Asset",
    "asset_tag_seq",
    "Assignment",
    "ReplacementRequest",
    "MaintenanceRecord",
    "AssetRequest",
]
