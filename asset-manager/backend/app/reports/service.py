from collections.abc import Iterator
import csv
import io
from datetime import datetime, timezone

from fpdf import FPDF
from fpdf.fonts import FontFace
from sqlalchemy.orm import Session

from app.common.enums import AssetStatus
from app.reports.repository import ReportsRepository
from app.reports.schemas import (
    CategoryReportItem,
    ReportsSummaryResponse,
    StatusCountItem,
)


class AssetRegisterPDF(FPDF):
    """Landscape register PDF with a stable page footer."""

    def footer(self) -> None:
        self.set_y(-9)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(100, 116, 139)
        self.cell(0, 4, f"Page {self.page_no()}/{{nb}}", align="C")


class ReportsService:
    CSV_HEADERS = [
        "id",
        "tag",
        "name",
        "serial_no",
        "service_tag",
        "asset_tag",
        "category_id",
        "category",
        "status",
        "location",
        "purchase_date",
        "cost",
        "assigned_to_name",
        "assigned_to_email",
        "awaiting_employee_details",
        "version",
        "created_at",
    ]

    # Single landscape table aligned to Asset Register columns.
    # (key, header, width_pct) — width_pct must sum to 100.
    PDF_TABLE_COLUMNS: list[tuple[str, str, float]] = [
        ("tag", "Asset ID", 10.0),
        ("name", "Name", 10.5),
        ("serial_no", "Serial No", 7.5),
        ("service_tag", "Service Tag", 7.0),
        ("asset_tag", "Asset Tag", 7.0),
        ("category", "Category", 7.5),
        ("status", "Status", 8.0),
        ("location", "Location", 8.0),
        ("purchase_date", "Purchase", 6.5),
        ("cost", "Cost", 6.5),
        ("assigned_to_name", "Assigned To", 7.0),
        ("assigned_to_email", "Email", 7.5),
        ("created_at", "Created", 7.0),
    ]

    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = ReportsRepository(db)

    def get_summary(self) -> ReportsSummaryResponse:
        by_status, total_assets, total_value = self.repo.get_status_counts_and_value()
        cat_rows = self.repo.get_category_breakdown()

        status_breakdown = [
            StatusCountItem(status=status_enum, count=by_status.get(status_enum.value, 0))
            for status_enum in (
                AssetStatus.AVAILABLE,
                AssetStatus.ASSIGNED,
                AssetStatus.IN_MAINTENANCE,
                AssetStatus.RETIRED,
            )
        ]

        by_category: dict[str, int] = {
            row["category_name"]: row["total"] for row in cat_rows
        }
        category_breakdown = [CategoryReportItem(**row) for row in cat_rows]

        return ReportsSummaryResponse(
            total_assets=total_assets,
            total_value=total_value,
            by_status=by_status,
            status_breakdown=status_breakdown,
            by_category=by_category,
            category_breakdown=category_breakdown,
        )

    def stream_assets_csv(
        self,
        status: AssetStatus | None = None,
        category_id: int | None = None,
        search: str | None = None,
    ) -> Iterator[str]:
        rows = self.repo.get_assets_for_csv(
            status=status,
            category_id=category_id,
            search=search,
        )

        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow(self.CSV_HEADERS)
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

        for row in rows:
            writer.writerow([row[col] for col in self.CSV_HEADERS])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    def build_assets_pdf(
        self,
        status: AssetStatus | None = None,
        category_id: int | None = None,
        search: str | None = None,
    ) -> bytes:
        rows = self.repo.get_assets_for_csv(
            status=status,
            category_id=category_id,
            search=search,
        )

        generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        filter_parts: list[str] = []
        if status is not None:
            filter_parts.append(f"Status={status.value}")
        if category_id is not None:
            filter_parts.append(f"Category ID={category_id}")
        if search and search.strip():
            filter_parts.append(f'Search="{search.strip()}"')
        filters_label = ", ".join(filter_parts) if filter_parts else "None (full register)"

        pdf = AssetRegisterPDF(orientation="L", unit="mm", format="A4")
        pdf.alias_nb_pages()
        pdf.set_auto_page_break(auto=True, margin=14)
        pdf.set_margins(10, 12, 10)
        pdf.add_page()

        usable_width = pdf.w - pdf.l_margin - pdf.r_margin

        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(15, 23, 42)
        pdf.cell(
            usable_width,
            8,
            self._pdf_text("AMS Asset Register"),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(71, 85, 105)
        pdf.cell(
            usable_width,
            5,
            self._pdf_text(
                f"Generated: {generated_at}   |   Filters: {filters_label}   |   "
                f"Total assets: {len(rows)}"
            ),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        pdf.ln(4)

        if not rows:
            pdf.set_text_color(15, 23, 42)
            pdf.set_font("Helvetica", "I", 11)
            pdf.cell(
                usable_width,
                8,
                self._pdf_text("No assets matched the selected filters."),
                new_x="LMARGIN",
                new_y="NEXT",
            )
            return bytes(pdf.output())

        self._write_pdf_table(pdf, usable_width, self.PDF_TABLE_COLUMNS, rows)

        pdf.ln(3)
        pdf.set_font("Helvetica", "I", 7.5)
        pdf.set_text_color(100, 116, 139)
        pdf.multi_cell(
            usable_width,
            4,
            self._pdf_text(
                "Tip: Export CSV for the full flat field set (internal ID, category ID, "
                "awaiting-details flag, version, and full timestamps)."
            ),
        )

        return bytes(pdf.output())

    def _write_pdf_table(
        self,
        pdf: FPDF,
        usable_width: float,
        columns: list[tuple[str, str, float]],
        rows: list[dict],
    ) -> None:
        col_widths = [round(usable_width * (pct / 100.0), 2) for _, _, pct in columns]
        width_sum = sum(col_widths[:-1])
        col_widths[-1] = round(usable_width - width_sum, 2)

        header_face = FontFace(
            emphasis="BOLD",
            color=(255, 255, 255),
            fill_color=(30, 64, 175),
            size_pt=7,
        )
        alt_face = FontFace(fill_color=(241, 245, 249), size_pt=7)
        body_face = FontFace(size_pt=7)

        with pdf.table(
            col_widths=col_widths,
            line_height=5.8,
            text_align="LEFT",
            borders_layout="ALL",
            cell_fill_mode="ROWS",
            first_row_as_headings=True,
            repeat_headings=1,
            width=usable_width,
        ) as table:
            heading = table.row()
            for _, header, _ in columns:
                heading.cell(self._pdf_text(header), style=header_face)

            for index, row in enumerate(rows):
                style = alt_face if index % 2 == 0 else body_face
                data_row = table.row()
                for col_index, (key, _, _) in enumerate(columns):
                    value = self._format_pdf_cell(key, row.get(key, ""))
                    fitted = self._pdf_fit(
                        pdf,
                        value,
                        max_width=max(col_widths[col_index] - 2.0, 6.0),
                        font_size=7,
                    )
                    data_row.cell(fitted or "-", style=style)

    @classmethod
    def _format_pdf_cell(cls, key: str, raw: object) -> str:
        if raw is None:
            return "-"
        value = str(raw).strip()
        if value == "":
            return "-"

        if key == "created_at":
            return value[:10]
        if key == "awaiting_employee_details":
            lowered = value.lower()
            if lowered in {"true", "1", "yes"}:
                return "Yes"
            if lowered in {"false", "0", "no"}:
                return "No"
            return value
        if key == "cost":
            try:
                return f"{float(value):,.2f}"
            except ValueError:
                return value
        if key == "location":
            return " ".join(value.replace("\n", " ").split())
        return value

    @staticmethod
    def _pdf_text(value: str) -> str:
        """Core PDF fonts are Latin-1; replace unsupported glyphs safely."""
        return (
            str(value)
            .replace("\u2014", "-")
            .replace("\u2013", "-")
            .replace("\u2018", "'")
            .replace("\u2019", "'")
            .replace("\u201c", '"')
            .replace("\u201d", '"')
            .encode("latin-1", errors="replace")
            .decode("latin-1")
        )

    @classmethod
    def _pdf_fit(
        cls, pdf: FPDF, value: str, max_width: float, font_size: int = 8
    ) -> str:
        """Truncate with ellipsis so cells stay on one readable line."""
        text = cls._pdf_text(value)
        pdf.set_font("Helvetica", "", font_size)
        if pdf.get_string_width(text) <= max_width:
            return text
        ellipsis = "..."
        while text and pdf.get_string_width(text + ellipsis) > max_width:
            text = text[:-1]
        return f"{text}{ellipsis}" if text else ellipsis
