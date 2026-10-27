from enum import Enum


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    ASSET_MANAGER = "ASSET_MANAGER"
    EMPLOYEE = "EMPLOYEE"


class AssetStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    ASSIGNED = "ASSIGNED"
    IN_MAINTENANCE = "IN_MAINTENANCE"
    RETIRED = "RETIRED"


class ReturnReason(str, Enum):
    REPLACEMENT = "REPLACEMENT"
    EMPLOYEE_LEFT = "EMPLOYEE_LEFT"
    OTHER = "OTHER"
    IN_MAINTENANCE = "IN_MAINTENANCE"


class OldAssetAction(str, Enum):
    REPAIR = "REPAIR"
    RETIRE = "RETIRE"


class ReplacementStatus(str, Enum):
    PENDING = "PENDING"
    ON_HOLD = "ON_HOLD"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    COMPLETED = "COMPLETED"


class AssetRequestStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
