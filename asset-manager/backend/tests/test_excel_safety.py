"""Uploaded workbooks are untrusted: a zip bomb and an XML entity bomb are refused."""
import io
import zipfile

import pytest

from app.common import excel
from app.common.exceptions import BadRequestException


def _xlsx(sheet_xml: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
    return buffer.getvalue()


def test_a_workbook_that_unpacks_too_large_is_refused(monkeypatch):
    monkeypatch.setattr(excel, "MAX_UNPACKED_BYTES", 1024)
    with pytest.raises(BadRequestException, match="too large"):
        excel.parse_xlsx_bytes(_xlsx("<worksheet>" + " " * 4096 + "</worksheet>"))


def test_xml_entities_in_a_workbook_are_refused():
    bomb = (
        '<?xml version="1.0"?><!DOCTYPE w [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>'
        "<worksheet><sheetData><row><c><v>&b;</v></c></row></sheetData></worksheet>"
    )
    with pytest.raises(BadRequestException, match="not a valid"):  # defusedxml refuses entities
        excel.parse_xlsx_bytes(_xlsx(bomb))
