from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.common.database import get_db
from app.common.enums import AssetStatus, UserRole
from app.common.security import require_roles
from app.reports.schemas import ReportsSummaryResponse
from app.reports.service import ReportsService
from app.users.models import User

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/summary", response_model=ReportsSummaryResponse)
def get_reports_summary(
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> ReportsSummaryResponse:
    """Return executive summary counts of assets by status and category (FR-12)."""
    service = ReportsService(db)
    return service.get_summary()


@router.get("/assets.csv")
def export_assets_csv(
    status: AssetStatus | None = Query(default=None, description="Optional status filter"),
    category_id: int | None = Query(default=None, ge=1, description="Optional category ID filter"),
    search: str | None = Query(default=None, description="Optional search by name or tag"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> StreamingResponse:
    """Stream the asset register as a downloadable CSV report (FR-12)."""
    service = ReportsService(db)
    csv_generator = service.stream_assets_csv(
        status=status,
        category_id=category_id,
        search=search,
    )
    return StreamingResponse(
        csv_generator,
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="assets_report.csv"',
        },
    )


@router.get("/assets.pdf")
def export_assets_pdf(
    status: AssetStatus | None = Query(default=None, description="Optional status filter"),
    category_id: int | None = Query(default=None, ge=1, description="Optional category ID filter"),
    search: str | None = Query(default=None, description="Optional search by name or tag"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.ASSET_MANAGER)),
) -> Response:
    """Download the asset register as a PDF with full asset details (FR-12)."""
    service = ReportsService(db)
    pdf_bytes = service.build_assets_pdf(
        status=status,
        category_id=category_id,
        search=search,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="assets_report.pdf"',
        },
    )
