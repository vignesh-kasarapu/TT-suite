"""CSV / Excel export for report rows. Rows are the same dicts the JSON report
endpoints return, so an export always matches what the screen shows."""
import csv
import io
import json
from datetime import date, datetime

from fastapi import Response

EXPORT_FORMATS = {"csv", "xlsx"}


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=str)
    if isinstance(value, (datetime, date)):
        return value.isoformat(sep=" ") if isinstance(value, datetime) else value.isoformat()
    return value


def build_response(rows: list[dict], file_format: str, name: str, columns: list[str] | None = None) -> Response:
    columns = columns or (list(rows[0].keys()) if rows else [])
    stamp = date.today().isoformat()
    filename = f"{name}-{stamp}.{file_format}"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}

    if file_format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(columns)
        for row in rows:
            writer.writerow([_cell(row.get(c)) for c in columns])
        # BOM so Excel opens UTF-8 names correctly.
        return Response("\ufeff" + buffer.getvalue(), media_type="text/csv; charset=utf-8", headers=headers)

    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = name[:31]
    sheet.append(columns)
    for row in rows:
        sheet.append([_cell(row.get(c)) for c in columns])
    out = io.BytesIO()
    workbook.save(out)
    return Response(
        out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
