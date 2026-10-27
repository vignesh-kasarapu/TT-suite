"""Tests for app/services/parser.py"""

from __future__ import annotations

import sys
import os
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

# Allow importing from backend
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.services.parser import NeedsOCRError, ParsedDocument, parse_document, _normalize_phone, extract_location


# ---------------------------------------------------------------------------
# PDF parsing
# ---------------------------------------------------------------------------

class TestPDFParsing:
    def _make_fitz_doc(self, blocks_per_page: list[list[tuple]]):
        """Build a mock fitz document with given blocks per page."""
        mock_doc = MagicMock()
        mock_doc.__iter__ = MagicMock(return_value=iter([
            self._make_page(blocks) for blocks in blocks_per_page
        ]))
        mock_doc.close = MagicMock()
        return mock_doc

    def _make_page(self, blocks: list[tuple]):
        page = MagicMock()
        page.get_text = MagicMock(return_value=blocks)
        # Two-column layout detection (_blocks_in_reading_order / _find_column_split)
        # compares page.rect.width numerically — needs a real float, not a MagicMock.
        page.rect.width = 612.0  # standard US-Letter width in points
        return page

    def test_pdf_basic_text_extraction(self):
        """Blocks with known text should be joined in sort order."""
        # Text must clear parser.py's 100-char "too short, needs OCR" floor.
        blocks = [
            # (x0, y0, x1, y1, text, block_no, block_type)
            (0, 40, 200, 60, "Second line because y=40 with enough extra padding text", 1, 0),
            (0, 0, 200, 20, "First line because y=0 with enough extra padding text here", 0, 0),
            (210, 0, 400, 20, "Same row right column also padded out a bit further", 2, 0),
        ]
        mock_doc = self._make_fitz_doc([blocks])

        with patch("fitz.open", return_value=mock_doc):
            result = parse_document("/fake/resume.pdf")

        assert isinstance(result, ParsedDocument)
        assert result.source_format == "pdf"
        # y=0 lines should appear before y=40 line
        assert "First line" in result.text
        assert "Second line" in result.text
        lines = result.text.split("\n")
        first_idx = next(i for i, l in enumerate(lines) if "First line" in l)
        second_idx = next(i for i, l in enumerate(lines) if "Second line" in l)
        assert first_idx < second_idx

    def test_pdf_page_count(self):
        """page_count should equal the number of pages in the document."""
        blocks = [(0, 0, 100, 20, "Page text with enough content " * 5, 0, 0)]
        mock_doc = self._make_fitz_doc([blocks, blocks, blocks])

        with patch("fitz.open", return_value=mock_doc):
            result = parse_document("/fake/multipage.pdf")

        assert result.page_count == 3

    def test_pdf_needs_ocr_error_raised_when_text_too_short(self):
        """NeedsOCRError should be raised when extracted text is < 100 characters."""
        blocks = [(0, 0, 100, 20, "Short", 0, 0)]
        mock_doc = self._make_fitz_doc([blocks])

        with patch("fitz.open", return_value=mock_doc):
            with pytest.raises(NeedsOCRError, match="too short"):
                parse_document("/fake/scanned.pdf")

    def test_pdf_empty_blocks_ignored(self):
        """Blocks with only whitespace should be excluded from text."""
        blocks = [
            (0, 0, 100, 20, "   ", 0, 0),
            (0, 40, 100, 60, "Real content here for testing purposes " * 4, 1, 0),
        ]
        mock_doc = self._make_fitz_doc([blocks])

        with patch("fitz.open", return_value=mock_doc):
            result = parse_document("/fake/sparse.pdf")

        assert "Real content" in result.text
        assert result.text.strip() != ""


# ---------------------------------------------------------------------------
# DOCX parsing
# ---------------------------------------------------------------------------

class TestDOCXParsing:
    def _make_docx(self, paragraph_texts: list[str], table_cells: list[str] | None = None):
        """Build a minimal mock python-docx Document."""
        mock_doc = MagicMock()

        # Paragraphs
        paragraphs = []
        for text in paragraph_texts:
            para = MagicMock()
            para.text = text
            paragraphs.append(para)
        mock_doc.paragraphs = paragraphs

        # Tables
        if table_cells:
            cell_mocks = []
            for cell_text in table_cells:
                cell = MagicMock()
                cell.text = cell_text
                cell_mocks.append(cell)

            row = MagicMock()
            row.cells = cell_mocks
            table = MagicMock()
            table.rows = [row]
            mock_doc.tables = [table]
        else:
            mock_doc.tables = []

        return mock_doc

    def test_docx_basic_text_extraction(self):
        """Paragraph text should appear in the parsed document."""
        mock_doc = self._make_docx(["Hello World", "Second paragraph", "Third"])

        with patch("docx.Document", return_value=mock_doc):
            result = parse_document("/fake/resume.docx")

        assert result.source_format == "docx"
        assert "Hello World" in result.text
        assert "Second paragraph" in result.text

    def test_docx_table_cells_included(self):
        """Text from table cells should be included in extracted text."""
        mock_doc = self._make_docx(
            ["Main paragraph content here"],
            table_cells=["Cell A", "Cell B"],
        )

        with patch("docx.Document", return_value=mock_doc):
            result = parse_document("/fake/table_resume.docx")

        assert "Cell A" in result.text
        assert "Cell B" in result.text

    def test_docx_empty_paragraphs_skipped(self):
        """Empty paragraphs should not contribute blank lines."""
        mock_doc = self._make_docx(["", "Real content", "", "More content"])

        with patch("docx.Document", return_value=mock_doc):
            result = parse_document("/fake/sparse.docx")

        assert "Real content" in result.text
        # Should not have multiple consecutive blank lines
        assert "\n\n\n" not in result.text

    def test_docx_source_format_is_docx(self):
        mock_doc = self._make_docx(["Content"])
        with patch("docx.Document", return_value=mock_doc):
            result = parse_document("/fake/file.docx")
        assert result.source_format == "docx"


# ---------------------------------------------------------------------------
# Unsupported format
# ---------------------------------------------------------------------------

class TestUnsupportedFormat:
    def test_txt_raises_value_error(self):
        with pytest.raises(ValueError, match="Unsupported file format"):
            parse_document("/fake/resume.txt")

    def test_png_raises_value_error(self):
        with pytest.raises(ValueError, match="Unsupported file format"):
            parse_document("/fake/scan.png")


# ---------------------------------------------------------------------------
# Phone Normalization & Location Extraction
# ---------------------------------------------------------------------------

class TestPhoneNormalization:
    def test_normalize_empty_or_none(self):
        assert _normalize_phone("") == ""
        assert _normalize_phone(None) == ""

    def test_normalize_standard_numbers(self):
        # 10 digits
        assert _normalize_phone("9876543210") == "9876543210"
        # with symbols
        assert _normalize_phone("+91-98765-43210") == "9876543210"
        assert _normalize_phone("+1 (555) 019-2834") == "5550192834"
        # less than 10 digits
        assert _normalize_phone("12345") == "12345"
        # more than 10 digits gets last 10
        assert _normalize_phone("19876543210") == "9876543210"


class TestLocationExtraction:
    def test_location_empty_or_none(self):
        assert extract_location("") is None
        assert extract_location(None) is None

    def test_location_explicit_labels(self):
        text = "Name: John Doe\nLocation: Bengaluru, Karnataka, India\nPhone: +91 9876543210"
        assert extract_location(text) == "Bengaluru, Karnataka, India"

        text_alt = "Address: Pune, Maharashtra\nContact: 12345"
        assert extract_location(text_alt) == "Pune, Maharashtra"

    def test_location_known_cities(self):
        text = "Rahul Nair\nEmail: rahul@example.com\nHyderabad, Telangana\nSoftware Engineer"
        # Hyderabad is a known city
        assert extract_location(text) == "Hyderabad, Telangana"

        text_bangalore = "Tejaswi K\nBengaluru\nJava Developer"
        assert extract_location(text_bangalore) == "Bengaluru"

    def test_location_us_pattern(self):
        text = "Jane Smith\nSan Francisco, CA 94103\nEmail: jane@example.com"
        assert extract_location(text) == "San Francisco, CA"

    def test_location_skips_skill_lines_with_fake_state_codes(self):
        """Regression: Pass 3's "City, ST" regex matched ANY "Capitalized
        Phrase, XX" pair with no check that XX was a real state code — so a
        skills line like "Redis, Flask, Spring Boot, CI/CD" (CI/CD is a real
        skill abbreviation) got misread as a location ("Spring Boot, CI"),
        because \\b matches right before the "/". Confirmed live via the
        seeded demo dataset (candidate_location values like "AWS, CI",
        "Redis, CI", "Flask, CI" all traced back to this regex)."""
        text = (
            "Priya Sharma\npriya@example.com\n"
            "Skills\nRedis, Flask, Spring Boot, CI/CD, AWS\n"
            "Experience\nBackend Engineer - Acme Corp (2021 - 2024)"
        )
        assert extract_location(text) is None

    def test_location_us_pattern_rejects_non_state_two_letter_codes(self):
        text = "Priya Sharma\nSpring Boot, CI\nEmail: priya@example.com"
        assert extract_location(text) is None
