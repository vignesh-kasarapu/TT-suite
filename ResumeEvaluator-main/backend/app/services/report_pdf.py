"""Renders a custom report (config + aggregate result + candidate list) to a
branded PDF using PyMuPDF's HTML/CSS-subset Story renderer.

`pymupdf` is already a backend dependency (used for resume parsing elsewhere),
so this avoids pulling in a second PDF library for what is fundamentally one
header, a filter summary, and two tables.
"""
from __future__ import annotations

import html
import io
from typing import TYPE_CHECKING, List

import fitz

if TYPE_CHECKING:
    from app.routers.reports import DrilldownCandidateOut, ReportRunRequest, ReportRunResult

_BRAND_COLOR = "#534AB7"

_STYLE = """
<style>
  body { font-family: Helvetica, sans-serif; font-size: 10px; color: #222; }
  h1 { color: %s; font-size: 18px; margin-bottom: 2px; }
  .subtitle { color: #666; font-size: 10px; margin-bottom: 14px; }
  h2 { font-size: 12px; color: %s; margin-top: 16px; margin-bottom: 6px; border-bottom: 1px solid #ddd; padding-bottom: 2px; }
  table { width: 100%%; border-collapse: collapse; margin-bottom: 10px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #eee; font-size: 9px; }
  th { background: #f4f3fb; color: #333; }
  .filters { font-size: 9px; color: #444; margin-bottom: 10px; }
  .filters span { display: inline-block; background: #f4f3fb; border-radius: 4px; padding: 2px 8px; margin-right: 6px; }
</style>
""" % (_BRAND_COLOR, _BRAND_COLOR)


def _esc(value: object) -> str:
    return html.escape("" if value is None else str(value))


def _filters_html(config: "ReportRunRequest") -> str:
    if not config.filters:
        return "<p class='filters'><span>No filters applied</span></p>"
    parts = []
    for key, value in config.filters.items():
        if isinstance(value, dict):
            value = ", ".join(f"{k}={v}" for k, v in value.items() if v)
        parts.append(f"<span>{_esc(key)}: {_esc(value)}</span>")
    return f"<p class='filters'>{''.join(parts)}</p>"


def _summary_table_html(config: "ReportRunRequest", result: "ReportRunResult") -> str:
    if not config.dimensions and not config.metrics:
        return ""
    headers = "".join(f"<th>{_esc(c)}</th>" for c in (*config.dimensions, *config.metrics))
    rows_html = []
    for row in result.rows:
        cells = [row.dimensions.get(d, "") for d in config.dimensions]
        cells += [row.metrics.get(m, "") for m in config.metrics]
        rows_html.append("<tr>" + "".join(f"<td>{_esc(c)}</td>" for c in cells) + "</tr>")
    if not rows_html:
        rows_html.append(f"<tr><td colspan='{len(config.dimensions) + len(config.metrics)}'>No data for this selection.</td></tr>")
    return f"<h2>Summary</h2><table><thead><tr>{headers}</tr></thead><tbody>{''.join(rows_html)}</tbody></table>"


_CANDIDATE_COLUMNS = (
    "Name", "Email", "Role", "Stage", "Score", "Experience", "Evaluated", "Summary",
)


def _candidates_table_html(candidates: List["DrilldownCandidateOut"]) -> str:
    headers = "".join(f"<th>{c}</th>" for c in _CANDIDATE_COLUMNS)
    rows_html = []
    for c in candidates:
        evaluated = (c.evaluated_at or "")[:10]
        summary = (c.reasoning_summary or "")[:180]
        cells = [
            c.candidate_name, c.candidate_email or "", c.job_role_title or "",
            c.stage, f"{c.total_score:.1f}", c.experience_level or "", evaluated, summary,
        ]
        rows_html.append("<tr>" + "".join(f"<td>{_esc(x)}</td>" for x in cells) + "</tr>")
    if not rows_html:
        rows_html.append(f"<tr><td colspan='{len(_CANDIDATE_COLUMNS)}'>No candidates match this selection.</td></tr>")
    return (
        f"<h2>Candidates ({len(candidates)})</h2>"
        f"<table><thead><tr>{headers}</tr></thead><tbody>{''.join(rows_html)}</tbody></table>"
    )


def build_report_pdf(
    title: str,
    config: "ReportRunRequest",
    result: "ReportRunResult",
    candidates: List["DrilldownCandidateOut"],
) -> bytes:
    body_html = (
        f"<h1>Tektalis — {_esc(title)}</h1>"
        f"<p class='subtitle'>Resume Evaluator report</p>"
        f"{_filters_html(config)}"
        f"{_summary_table_html(config, result)}"
        f"{_candidates_table_html(candidates)}"
    )
    html_doc = f"<html><head>{_STYLE}</head><body>{body_html}</body></html>"

    story = fitz.Story(html=html_doc)
    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)
    mediabox = fitz.paper_rect("a4")
    where = mediabox + (36, 36, -36, -36)

    more = 1
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()

    return buf.getvalue()
