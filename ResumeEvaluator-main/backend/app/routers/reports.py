"""Custom report builder: whitelisted dimensions/metrics over evaluation data,
plus CRUD for saved report definitions, candidate drilldown, PDF export, and
public share links.

Dimension/metric/filter names are resolved through fixed lookup tables only —
never interpolated into SQL — so arbitrary user input can't reach the query.
"""
from __future__ import annotations

import csv
import io
import json
import logging
import secrets
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Query, Session

from app.deps import get_current_user, get_db, require_staff
from app.models import Candidate, Evaluation, JobRole, JobRoleSkill, SavedReport, User
from app.services.analytics_queries import active_evaluations_query
from app.services.report_pdf import build_report_pdf

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_staff)])

# Public, unauthenticated view for shared reports — deliberately NOT on
# `router`, since that applies `require_staff` to every route.
public_router = APIRouter(prefix="/reports", tags=["reports"])


# ---------------------------------------------------------------------------
# Whitelisted schema
# ---------------------------------------------------------------------------

DIMENSIONS: Dict[str, Dict[str, Any]] = {
    "experience_level": {"label": "Experience Level", "column": Candidate.experience_level},
    "location": {"label": "Location", "column": Candidate.location},
    "stage": {"label": "Stage", "column": Evaluation.stage},
    "job_role": {"label": "Job Role", "column": JobRole.title},
}

METRICS: Dict[str, Dict[str, Any]] = {
    "count": {"label": "Count", "expr": func.count(Evaluation.id)},
    "avg_score": {"label": "Avg Score", "expr": func.avg(Evaluation.total_score)},
    "hire_rate": {
        "label": "Hire Rate %",
        "expr": func.avg(case((Evaluation.stage == "hired", 1.0), else_=0.0)) * 100,
    },
}

FILTERS: Dict[str, Dict[str, str]] = {
    "job_role_id": {"label": "Job Role", "type": "job_role_id"},
    "date_range": {"label": "Date Range", "type": "date_range"},
    "stage": {"label": "Stage", "type": "stage"},
    "experience_level": {"label": "Experience Level", "type": "experience_level"},
    "location": {"label": "Location", "type": "location"},
}


class SchemaOut(BaseModel):
    dimensions: List[Dict[str, str]]
    metrics: List[Dict[str, str]]
    filters: List[Dict[str, str]]


@router.get("/schema", response_model=SchemaOut)
def get_schema() -> SchemaOut:
    return SchemaOut(
        dimensions=[{"key": k, "label": v["label"]} for k, v in DIMENSIONS.items()],
        metrics=[{"key": k, "label": v["label"]} for k, v in METRICS.items()],
        filters=[{"key": k, "label": v["label"], "type": v["type"]} for k, v in FILTERS.items()],
    )


# ---------------------------------------------------------------------------
# Shared filter/validation helpers
# ---------------------------------------------------------------------------

class ReportRunRequest(BaseModel):
    dimensions: List[str] = Field(default_factory=list)
    metrics: List[str] = Field(default_factory=list)
    filters: Dict[str, Any] = Field(default_factory=dict)


class ReportRow(BaseModel):
    dimensions: Dict[str, str]
    metrics: Dict[str, float]


class ReportRunResult(BaseModel):
    rows: List[ReportRow]


def _validate_keys(keys: List[str], whitelist: Dict[str, Any], kind: str) -> None:
    unknown = [k for k in keys if k not in whitelist]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown {kind}: {', '.join(unknown)}",
        )


def _parse_date(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return datetime.combine(date.fromisoformat(value), datetime.min.time())


def _apply_filters(q: Query, filters: Dict[str, Any]) -> Query:
    """Apply the whitelisted, non-job_role_id filters shared by run/drilldown/PDF.

    `job_role_id` is handled separately by callers since it's passed into
    `active_evaluations_query()` itself (it narrows the base join, not a
    post-hoc `.filter()`).
    """
    if "stage" in filters:
        q = q.filter(Evaluation.stage == filters["stage"])
    if "experience_level" in filters:
        q = q.filter(Candidate.experience_level == filters["experience_level"])
    if "location" in filters:
        q = q.filter(Candidate.location == filters["location"])
    if "date_range" in filters:
        dr = filters["date_range"] or {}
        start = dr.get("start")
        end = dr.get("end")
        if start:
            q = q.filter(Evaluation.evaluated_at >= _parse_date(start))
        if end:
            q = q.filter(Evaluation.evaluated_at <= _parse_date(end))
    return q


def _run_report_query(db: Session, body: ReportRunRequest) -> ReportRunResult:
    if not body.dimensions and not body.metrics:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one dimension or metric")
    _validate_keys(body.dimensions, DIMENSIONS, "dimension")
    _validate_keys(body.metrics, METRICS, "metric")
    _validate_keys(list(body.filters.keys()), FILTERS, "filter")

    job_role_id = body.filters.get("job_role_id")
    q = active_evaluations_query(db, job_role_id=job_role_id)

    if "job_role" in body.dimensions:
        q = q.join(JobRole, Evaluation.job_role_id == JobRole.id)

    q = _apply_filters(q, body.filters)

    group_cols = [DIMENSIONS[d]["column"] for d in body.dimensions]
    agg_cols = [METRICS[m]["expr"] for m in body.metrics]

    q = q.with_entities(*group_cols, *agg_cols)
    if group_cols:
        q = q.group_by(*group_cols)

    rows = q.all()

    n_dims = len(body.dimensions)
    out_rows: List[ReportRow] = []
    for row in rows:
        row_vals = tuple(row)
        dim_vals = row_vals[:n_dims]
        metric_vals = row_vals[n_dims:]
        out_rows.append(ReportRow(
            dimensions={d: ("" if v is None else str(v)) for d, v in zip(body.dimensions, dim_vals)},
            metrics={m: round(float(v), 2) if v is not None else 0.0 for m, v in zip(body.metrics, metric_vals)},
        ))

    return ReportRunResult(rows=out_rows)


# ---------------------------------------------------------------------------
# Run a report
# ---------------------------------------------------------------------------

@router.post("/run", response_model=ReportRunResult)
def run_report(
    body: ReportRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReportRunResult:
    return _run_report_query(db, body)


# ---------------------------------------------------------------------------
# Candidate drilldown
# ---------------------------------------------------------------------------

class ReportDrilldownRequest(BaseModel):
    dimensions: List[str] = Field(default_factory=list)
    metrics: List[str] = Field(default_factory=list)
    filters: Dict[str, Any] = Field(default_factory=dict)
    dimension_values: Dict[str, str] = Field(default_factory=dict)
    limit: int = Field(default=100, ge=1, le=5000)
    offset: int = Field(default=0, ge=0)


class DrilldownCandidateOut(BaseModel):
    evaluation_id: int
    candidate_id: int
    candidate_name: str
    candidate_email: Optional[str]
    candidate_phone: Optional[str]
    job_role_id: int
    job_role_title: Optional[str]
    current_title: Optional[str]
    experience_level: Optional[str]
    years_experience: Optional[float]
    location: Optional[str]
    stage: str
    total_score: float
    skills_matched: int
    skills_total: int
    matched_skill_names: List[str]
    evaluated_at: Optional[str]
    reasoning_summary: Optional[str]


class DrilldownResult(BaseModel):
    candidates: List[DrilldownCandidateOut]
    total: int


def _drilldown_query(db: Session, body: ReportDrilldownRequest) -> Query:
    _validate_keys(list(body.filters.keys()), FILTERS, "filter")
    _validate_keys(list(body.dimension_values.keys()), DIMENSIONS, "dimension")

    job_role_id = body.filters.get("job_role_id")
    q = active_evaluations_query(db, job_role_id=job_role_id)
    q = q.join(JobRole, Evaluation.job_role_id == JobRole.id)
    q = _apply_filters(q, body.filters)

    for key, value in body.dimension_values.items():
        q = q.filter(DIMENSIONS[key]["column"] == value)

    return q.with_entities(Evaluation, Candidate, JobRole.title)


def _skills_total_map(db: Session, job_role_ids: Set[int]) -> Dict[int, int]:
    """Total skill-requirement count per job role, for the "N of M skills matched" figure."""
    if not job_role_ids:
        return {}
    rows = (
        db.query(JobRoleSkill.job_role_id, func.count(JobRoleSkill.id))
        .filter(JobRoleSkill.job_role_id.in_(job_role_ids))
        .group_by(JobRoleSkill.job_role_id)
        .all()
    )
    return {r[0]: r[1] for r in rows}


def _parse_skills_matched(raw: Optional[str]) -> List[Dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def _to_drilldown_out(
    evaluation: Evaluation,
    candidate: Candidate,
    job_role_title: Optional[str],
    skills_total_map: Dict[int, int],
) -> DrilldownCandidateOut:
    sm_list = _parse_skills_matched(evaluation.skills_matched)
    matched_names = [m["skill_name"] for m in sm_list if isinstance(m, dict) and "skill_name" in m]
    return DrilldownCandidateOut(
        evaluation_id=evaluation.id,
        candidate_id=candidate.id,
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        candidate_phone=candidate.phone,
        job_role_id=evaluation.job_role_id,
        job_role_title=job_role_title,
        current_title=candidate.current_title,
        experience_level=candidate.experience_level,
        years_experience=candidate.years_experience,
        location=candidate.location,
        stage=evaluation.stage,
        total_score=evaluation.total_score,
        skills_matched=len(sm_list),
        skills_total=skills_total_map.get(evaluation.job_role_id, 0),
        matched_skill_names=matched_names[:8],
        evaluated_at=evaluation.evaluated_at.isoformat() if evaluation.evaluated_at else None,
        reasoning_summary=evaluation.reasoning_summary,
    )


def _rows_to_candidates(db: Session, rows: List[Any]) -> List[DrilldownCandidateOut]:
    role_ids = {ev.job_role_id for ev, _cand, _title in rows}
    skills_map = _skills_total_map(db, role_ids)
    return [_to_drilldown_out(ev, cand, title, skills_map) for ev, cand, title in rows]


def _full_drilldown_candidates(db: Session, body: ReportRunRequest, limit: int) -> List[DrilldownCandidateOut]:
    """All candidates matching a report's filters (no dimension_values narrowing) — used by PDF/CSV export and the public share view."""
    drilldown_body = ReportDrilldownRequest(
        dimensions=body.dimensions, metrics=body.metrics, filters=body.filters, limit=limit, offset=0,
    )
    q = _drilldown_query(db, drilldown_body)
    rows = q.order_by(Evaluation.total_score.desc()).limit(limit).all()
    return _rows_to_candidates(db, rows)


@router.post("/drilldown", response_model=DrilldownResult)
def run_report_drilldown(
    body: ReportDrilldownRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DrilldownResult:
    q = _drilldown_query(db, body)
    total = q.order_by(None).count()
    rows = q.order_by(Evaluation.total_score.desc()).offset(body.offset).limit(body.limit).all()
    candidates = _rows_to_candidates(db, rows)
    return DrilldownResult(candidates=candidates, total=total)


# ---------------------------------------------------------------------------
# PDF export
# ---------------------------------------------------------------------------

_PDF_MAX_CANDIDATES = 2000


def _build_pdf_response(db: Session, title: str, body: ReportRunRequest) -> Response:
    result = _run_report_query(db, body)
    candidates = _full_drilldown_candidates(db, body, _PDF_MAX_CANDIDATES)

    pdf_bytes = build_report_pdf(title=title, config=body, result=result, candidates=candidates)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="report.pdf"'},
    )


@router.post("/pdf")
def export_report_pdf(
    body: ReportRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    return _build_pdf_response(db, title="Custom Report", body=body)


@router.get("/{report_id}/pdf")
def export_saved_report_pdf(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    report = _get_owned_report(report_id, db, current_user)
    config = ReportRunRequest(**json.loads(report.config))
    return _build_pdf_response(db, title=report.name, body=config)


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------

_CSV_MAX_CANDIDATES = 5000

_CSV_HEADERS = [
    "Name", "Email", "Phone", "Job Role", "Stage", "Fit Score",
    "Experience Level", "Years Experience", "Evaluated Date", "Summary",
]


def _candidates_csv_response(candidates: List[DrilldownCandidateOut]) -> Response:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_CSV_HEADERS)
    for c in candidates:
        writer.writerow([
            c.candidate_name, c.candidate_email or "", c.candidate_phone or "",
            c.job_role_title or "", c.stage, f"{c.total_score:.1f}",
            c.experience_level or "", c.years_experience if c.years_experience is not None else "",
            (c.evaluated_at or "")[:10], (c.reasoning_summary or "").replace("\n", " ").replace("\r", " "),
        ])
    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="candidates.csv"'},
    )


@router.post("/candidates/csv")
def export_report_candidates_csv(
    body: ReportRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    candidates = _full_drilldown_candidates(db, body, _CSV_MAX_CANDIDATES)
    return _candidates_csv_response(candidates)


@router.get("/{report_id}/csv")
def export_saved_report_csv(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    report = _get_owned_report(report_id, db, current_user)
    config = ReportRunRequest(**json.loads(report.config))
    candidates = _full_drilldown_candidates(db, config, _CSV_MAX_CANDIDATES)
    return _candidates_csv_response(candidates)


# ---------------------------------------------------------------------------
# Saved reports CRUD
# ---------------------------------------------------------------------------

class SavedReportOut(BaseModel):
    id: int
    owner_id: int
    name: str
    config: ReportRunRequest
    created_at: str
    updated_at: Optional[str]
    share_token: Optional[str]
    is_shared: bool


class SavedReportCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    config: ReportRunRequest


def _to_out(r: SavedReport) -> SavedReportOut:
    try:
        config = ReportRunRequest(**json.loads(r.config))
    except (json.JSONDecodeError, TypeError, ValueError):
        config = ReportRunRequest()
    return SavedReportOut(
        id=r.id,
        owner_id=r.owner_id,
        name=r.name,
        config=config,
        created_at=r.created_at.isoformat(),
        updated_at=r.updated_at.isoformat() if r.updated_at else None,
        share_token=r.share_token,
        is_shared=bool(r.is_shared),
    )


@router.get("", response_model=List[SavedReportOut])
def list_saved_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[SavedReportOut]:
    q = db.query(SavedReport)
    if current_user.role != "admin":
        q = q.filter(SavedReport.owner_id == current_user.id)
    reports = q.order_by(SavedReport.created_at.desc()).all()
    return [_to_out(r) for r in reports]


@router.get("/{report_id}", response_model=SavedReportOut)
def get_saved_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedReportOut:
    return _to_out(_get_owned_report(report_id, db, current_user))


@router.post("", response_model=SavedReportOut, status_code=status.HTTP_201_CREATED)
def create_saved_report(
    body: SavedReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedReportOut:
    _validate_keys(body.config.dimensions, DIMENSIONS, "dimension")
    _validate_keys(body.config.metrics, METRICS, "metric")
    report = SavedReport(
        owner_id=current_user.id,
        name=body.name,
        config=body.config.model_dump_json(),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return _to_out(report)


@router.patch("/{report_id}", response_model=SavedReportOut)
def update_saved_report(
    report_id: int,
    body: SavedReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedReportOut:
    _validate_keys(body.config.dimensions, DIMENSIONS, "dimension")
    _validate_keys(body.config.metrics, METRICS, "metric")
    report = _get_owned_report(report_id, db, current_user)
    report.name = body.name
    report.config = body.config.model_dump_json()
    report.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(report)
    return _to_out(report)


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_saved_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    report = _get_owned_report(report_id, db, current_user)
    db.delete(report)
    db.commit()


def _get_owned_report(report_id: int, db: Session, current_user: User) -> SavedReport:
    report = db.query(SavedReport).filter(SavedReport.id == report_id).first()
    if report is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    if report.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot access another user's report")
    return report


# ---------------------------------------------------------------------------
# Sharing
# ---------------------------------------------------------------------------

@router.post("/{report_id}/share", response_model=SavedReportOut)
def share_saved_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedReportOut:
    report = _get_owned_report(report_id, db, current_user)
    if not report.share_token:
        report.share_token = secrets.token_urlsafe(32)
    report.is_shared = True
    db.commit()
    db.refresh(report)
    return _to_out(report)


@router.delete("/{report_id}/share", response_model=SavedReportOut)
def unshare_saved_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SavedReportOut:
    report = _get_owned_report(report_id, db, current_user)
    report.is_shared = False
    db.commit()
    db.refresh(report)
    return _to_out(report)


_SHARE_VIEW_MAX_CANDIDATES = 500


class SharedReportViewOut(BaseModel):
    name: str
    config: ReportRunRequest
    result: ReportRunResult
    candidates: List[DrilldownCandidateOut]


@public_router.get("/view/{token}", response_model=SharedReportViewOut)
def get_shared_report(
    token: str,
    db: Session = Depends(get_db),
) -> SharedReportViewOut:
    report = db.query(SavedReport).filter(SavedReport.share_token == token).first()
    if report is None or not report.is_shared:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared report not found")
    config = ReportRunRequest(**json.loads(report.config))
    result = _run_report_query(db, config)
    candidates = _full_drilldown_candidates(db, config, _SHARE_VIEW_MAX_CANDIDATES)
    return SharedReportViewOut(name=report.name, config=config, result=result, candidates=candidates)
