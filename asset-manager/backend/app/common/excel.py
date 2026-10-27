import base64
import csv
from datetime import date, datetime, timedelta
import io
import re
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
import zipfile

from app.common.exceptions import BadRequestException

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _col_index_to_letter(index: int) -> str:
    """Convert 0-based column index to Excel column letters (0 -> A, 25 -> Z, 26 -> AA)."""
    result = ""
    n = index + 1
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _cell_ref_to_col_index(cell_ref: str) -> int | None:
    """Extract 0-based column index from an Excel cell reference like 'C12' -> 2."""
    match = re.match(r"^([A-Za-z]+)", cell_ref.strip())
    if not match:
        return None
    letters = match.group(1).upper()
    col_idx = 0
    for ch in letters:
        col_idx = col_idx * 26 + (ord(ch) - ord("A") + 1)
    return col_idx - 1


def build_xlsx_bytes(
    headers: list[str],
    rows: list[list[str]],
    sheet_name: str = "ImportTemplate",
) -> bytes:
    """Build a standards-compliant Microsoft Excel (.xlsx) workbook in memory."""
    all_rows = [headers, *rows]

    cols_xml_parts: list[str] = []
    for col_idx, header in enumerate(headers):
        max_len = max(
            [len(str(header))]
            + [len(str(r[col_idx])) for r in rows if col_idx < len(r)]
        )
        width = max(14, min(42, max_len + 5))
        col_num = col_idx + 1
        cols_xml_parts.append(
            f'<col min="{col_num}" max="{col_num}" width="{width}" customWidth="1"/>'
        )
    cols_xml = f"<cols>{''.join(cols_xml_parts)}</cols>" if cols_xml_parts else ""

    sheet_rows_xml: list[str] = []
    for row_idx, row_values in enumerate(all_rows, start=1):
        cells_xml: list[str] = []
        style_attr = ' s="1"' if row_idx == 1 else ""
        for col_idx, raw_val in enumerate(row_values):
            col_letter = _col_index_to_letter(col_idx)
            cell_ref = f"{col_letter}{row_idx}"
            text_val = escape(str(raw_val if raw_val is not None else ""))
            cells_xml.append(
                f'<c r="{cell_ref}" t="inlineStr"{style_attr}><is><t>{text_val}</t></is></c>'
            )
        sheet_rows_xml.append(f'<row r="{row_idx}">{"".join(cells_xml)}</row>')

    worksheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"{cols_xml}"
        f'<sheetData>{"".join(sheet_rows_xml)}</sheetData>'
        "</worksheet>"
    )

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>"
    )

    root_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )

    safe_sheet = escape(sheet_name[:31] or "Sheet1")
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{safe_sheet}" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )

    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
        "</Relationships>"
    )

    styles_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2">'
        '<font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
        "</fonts>"
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>'
        "</fills>"
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
        "</cellXfs>"
        "</styleSheet>"
    )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", root_rels_xml)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
        zf.writestr("xl/styles.xml", styles_xml)
        zf.writestr("xl/worksheets/sheet1.xml", worksheet_xml)

    return buffer.getvalue()


def decode_excel_base64(excel_base64: str) -> bytes:
    """Decode a Base64-encoded .xlsx payload (with or without data URL prefix)."""
    cleaned = excel_base64.strip()
    if "," in cleaned and cleaned.lower().startswith("data:"):
        cleaned = cleaned.split(",", 1)[1].strip()
    try:
        return base64.b64decode(cleaned, validate=False)
    except Exception as exc:
        raise BadRequestException("Invalid Base64 Excel file payload") from exc


def parse_xlsx_bytes(file_bytes: bytes) -> tuple[list[str], list[dict[str, str]]]:
    """Parse an .xlsx file into normalized headers and row dictionaries."""
    if not file_bytes:
        raise BadRequestException("Excel (.xlsx) file is empty")

    try:
        zf = zipfile.ZipFile(io.BytesIO(file_bytes), mode="r")
    except Exception as exc:
        raise BadRequestException(
            "Uploaded file is not a valid Excel (.xlsx) workbook"
        ) from exc

    with zf:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in ss_root.findall(f"{{{MAIN_NS}}}si"):
                texts = [t.text or "" for t in si.iter(f"{{{MAIN_NS}}}t")]
                shared_strings.append("".join(texts))

        worksheet_paths = sorted(
            name
            for name in zf.namelist()
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
        if not worksheet_paths:
            raise BadRequestException("Excel workbook contains no worksheets")

        ws_root = ET.fromstring(zf.read(worksheet_paths[0]))
        sheet_data = ws_root.find(f"{{{MAIN_NS}}}sheetData")
        if sheet_data is None:
            raise BadRequestException("Excel worksheet is empty")

        parsed_matrix: list[list[str]] = []
        for row_el in sheet_data.findall(f"{{{MAIN_NS}}}row"):
            row_cells: dict[int, str] = {}
            max_col_idx = -1
            next_seq_col = 0

            for cell_el in row_el.findall(f"{{{MAIN_NS}}}c"):
                cell_ref = cell_el.attrib.get("r", "")
                col_idx = _cell_ref_to_col_index(cell_ref)
                if col_idx is None:
                    col_idx = next_seq_col
                next_seq_col = col_idx + 1
                if col_idx > max_col_idx:
                    max_col_idx = col_idx

                cell_type = cell_el.attrib.get("t", "")
                raw_text = ""

                if cell_type == "inlineStr":
                    texts = [t.text or "" for t in cell_el.iter(f"{{{MAIN_NS}}}t")]
                    raw_text = "".join(texts)
                elif cell_type == "s":
                    v_el = cell_el.find(f"{{{MAIN_NS}}}v")
                    if v_el is not None and v_el.text is not None:
                        try:
                            ss_idx = int(v_el.text.strip())
                            if 0 <= ss_idx < len(shared_strings):
                                raw_text = shared_strings[ss_idx]
                        except ValueError:
                            raw_text = v_el.text.strip()
                elif cell_type == "b":
                    v_el = cell_el.find(f"{{{MAIN_NS}}}v")
                    if v_el is not None and v_el.text is not None:
                        raw_text = "true" if v_el.text.strip() in ("1", "true", "TRUE") else "false"
                else:
                    v_el = cell_el.find(f"{{{MAIN_NS}}}v")
                    if v_el is not None and v_el.text is not None:
                        raw_text = v_el.text.strip()
                    else:
                        texts = [t.text or "" for t in cell_el.iter(f"{{{MAIN_NS}}}t")]
                        raw_text = "".join(texts)

                row_cells[col_idx] = raw_text.strip()

            if max_col_idx >= 0:
                row_list = [row_cells.get(i, "") for i in range(max_col_idx + 1)]
                parsed_matrix.append(row_list)

        if not parsed_matrix:
            raise BadRequestException("Excel worksheet contains no rows")

        raw_headers = parsed_matrix[0]
        normalized_headers = [h.strip().lower() for h in raw_headers if h and h.strip()]
        if not normalized_headers:
            raise BadRequestException("Excel header row is missing")

        rows_out: list[dict[str, str]] = []
        for data_row in parsed_matrix[1:]:
            row_dict: dict[str, str] = {}
            for idx, header_val in enumerate(raw_headers):
                norm_h = header_val.strip().lower()
                if not norm_h:
                    continue
                row_dict[norm_h] = data_row[idx].strip() if idx < len(data_row) else ""
            rows_out.append(row_dict)

        return normalized_headers, rows_out


def parse_tabular_text(text_content: str) -> tuple[list[str], list[dict[str, str]]]:
    """Parse either Excel TSV copy-paste (tab-delimited) or CSV text into headers and row dicts."""
    cleaned = text_content.lstrip("\ufeff").strip()
    if not cleaned:
        raise BadRequestException("Import content cannot be empty")

    first_line = cleaned.splitlines()[0] if cleaned.splitlines() else ""
    delimiter = "\t" if "\t" in first_line else ","

    reader = csv.DictReader(io.StringIO(cleaned), delimiter=delimiter)
    if not reader.fieldnames:
        raise BadRequestException("Header row is missing")

    header_mapping = {
        h.strip().lower(): h for h in reader.fieldnames if h and h.strip()
    }
    normalized_headers = list(header_mapping.keys())
    if not normalized_headers:
        raise BadRequestException("Header row is missing")

    rows_out: list[dict[str, str]] = []
    for raw_row in reader:
        if raw_row is None:
            continue
        row_dict: dict[str, str] = {}
        for norm_key, orig_key in header_mapping.items():
            val = raw_row.get(orig_key)
            row_dict[norm_key] = val.strip() if isinstance(val, str) else ""
        rows_out.append(row_dict)

    return normalized_headers, rows_out


def parse_excel_or_iso_date(raw_date: str) -> date:
    """Parse ISO YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, or Excel serial date numbers."""
    cleaned = raw_date.strip()
    if not cleaned:
        raise ValueError("purchase_date cannot be blank")

    # Handle numeric Excel serial dates (e.g. 46096 -> 2026-03-15)
    if re.match(r"^\d+(\.0+)?$", cleaned):
        serial_num = int(float(cleaned))
        if 20000 <= serial_num <= 80000:
            return (datetime(1899, 12, 30) + timedelta(days=serial_num)).date()

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Invalid purchase_date '{raw_date}'. Expected YYYY-MM-DD")
