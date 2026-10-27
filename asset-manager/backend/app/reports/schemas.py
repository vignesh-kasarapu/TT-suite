from pydantic import BaseModel

from app.common.enums import AssetStatus


class StatusCountItem(BaseModel):
    status: AssetStatus
    count: int


class CategoryReportItem(BaseModel):
    category_id: int
    category_name: str
    total: int
    available: int
    assigned: int
    in_maintenance: int
    retired: int
    total_value: float


class ReportsSummaryResponse(BaseModel):
    total_assets: int
    total_value: float
    by_status: dict[str, int]
    status_breakdown: list[StatusCountItem]
    by_category: dict[str, int]
    category_breakdown: list[CategoryReportItem]
