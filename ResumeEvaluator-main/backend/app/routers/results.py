from __future__ import annotations

import csv
import io
import json
import logging
import math
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, desc, asc, or_, select as sa_select
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.deps import get_current_user, get_db, require_permission, require_staff
from app.routers.audit import record_audit
from app.models import (
    Candidate,
    Evaluation,
    InboundEmail,
    JobRole,
    JobRoleSkill,
    OrgEmployee,
    Resume,
    ResumeVersion,
    Shortlist,
    Skill,
    User,
)
from app.schemas import (
    EvaluationDetail,
    PaginatedResults,
    RejectionEmailRequest,
    RequirementBreakdown,
    ResultsResponse,
    ScreeningAnswerOut,
    SkillMatchDetail,
    UpdateCandidateStageRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/results", tags=["results"], dependencies=[Depends(require_staff)])


def _parse_json_list(raw: Optional[str]) -> list:
    """Safely parse a JSON-encoded list stored in a Text column. Returns [] on failure."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, ValueError):
        return []


# Whitelist of sortable columns to prevent ORM injection
_SORT_COLUMNS: Dict[str, Any] = {
    "total_score":    Evaluation.total_score,
    "project_score":  Evaluation.project_score,
    "skill_score":    Evaluation.skill_score,
    "education_score": Evaluation.education_score,
    "evaluated_at":   Evaluation.evaluated_at,
}


@router.get("", response_model=PaginatedResults)
def list_results(
    job_role_id: Optional[int] = Query(default=None),
    sort: str = Query(default="total_score", alias="sort_by"),
    order: str = Query(default="desc", pattern="^(asc|desc)$", alias="sort_dir"),
    shortlist_status: Optional[str] = Query(default=None, alias="status"),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedResults:
    """Paginated, DB-sorted list of evaluation results with candidate info."""

    # ── Base query with eager-loaded relations ────────────────────────────────
    # Subquery: resume_ids whose candidate is soft-deleted — exclude these from leaderboard
    soft_deleted_resume_ids = (
        db.query(Resume.id)
        .join(ResumeVersion, Resume.id == ResumeVersion.id)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .filter(Candidate.deleted_at.isnot(None))
    )

    query = (
        db.query(Evaluation)
        .join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .options(
            joinedload(Evaluation.resume)
            .joinedload(Resume.version)
            .joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.shortlists),
            joinedload(Evaluation.job_role),
        )
        # Exclude soft-deleted candidates, intake-paused evaluations, and non-current resume versions
        .filter(
            ResumeVersion.is_current.is_(True),
            Evaluation.resume_id.notin_(soft_deleted_resume_ids),
            or_(
                Evaluation.eval_status.is_(None),
                Evaluation.eval_status == "tfidf_filtered",
                Evaluation.eval_status == "experience_filtered",
            ),
        )
    )

    if job_role_id is not None:
        query = query.filter(Evaluation.job_role_id == job_role_id)

    # ── Name / email search ───────────────────────────────────────────────────
    if search and search.strip():
        term = f"%{search.strip().lower()}%"
        matching_resume_ids = (
            db.query(Resume.id)
            .join(ResumeVersion, Resume.id == ResumeVersion.id)
            .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
            .filter(
                or_(
                    func.lower(Candidate.name).like(term),
                    func.lower(Candidate.email).like(term),
                )
            )
            .subquery()
        )
        query = query.filter(Evaluation.resume_id.in_(matching_resume_ids))


    # ── Shortlist status filter (DB subquery, not Python loop) ────────────────
    if shortlist_status == "pending":
        # "pending" = no shortlist record at all
        query = query.filter(
            ~db.query(Shortlist.id)
            .filter(Shortlist.evaluation_id == Evaluation.id)
            .exists()
        )
    elif shortlist_status:
        latest_sl_subq = (
            db.query(Shortlist.status)
            .filter(Shortlist.evaluation_id == Evaluation.id)
            .order_by(Shortlist.changed_at.desc())
            .limit(1)
            .correlate(Evaluation)
            .scalar_subquery()
        )
        if shortlist_status == "rejected":
            query = query.filter(
                or_(
                    latest_sl_subq == "rejected",
                    Candidate.stage == "rejected",
                    Evaluation.eval_status.in_(["tfidf_filtered", "experience_filtered"]),
                )
            )
        elif shortlist_status == "review":
            query = query.filter(
                or_(
                    latest_sl_subq == "review",
                    Candidate.needs_manual_review.is_(True),
                )
            )
        else:
            query = query.filter(latest_sl_subq == shortlist_status)

    # ── DB-level sort (whitelisted column) ────────────────────────────────────
    sort_col = _SORT_COLUMNS.get(sort, Evaluation.total_score)
    query = query.order_by(desc(sort_col) if order == "desc" else asc(sort_col))

    # ── Total count before pagination ─────────────────────────────────────────
    total: int = query.count()
    pages = math.ceil(total / limit) if total > 0 else 1

    # ── Paginate ──────────────────────────────────────────────────────────────
    evals: List[Evaluation] = query.offset((page - 1) * limit).limit(limit).all()

    # ── Batch-load skills_total per job_role to avoid N+1 ────────────────────
    role_ids = {ev.job_role_id for ev in evals}
    skills_total_map: Dict[int, int] = {}
    if role_ids:
        rows = (
            db.query(JobRoleSkill.job_role_id, func.count(JobRoleSkill.id))
            .filter(JobRoleSkill.job_role_id.in_(role_ids))
            .group_by(JobRoleSkill.job_role_id)
            .all()
        )
        skills_total_map = {r[0]: r[1] for r in rows}

    # ── Build response items ──────────────────────────────────────────────────
    items: List[ResultsResponse] = []
    for ev in evals:
        rv: Optional[ResumeVersion] = ev.resume.version if ev.resume else None
        cand: Optional[Candidate] = rv.candidate if rv else None

        skills_matched_list = json.loads(ev.skills_matched) if ev.skills_matched else []

        project_match_label = "Low"
        if ev.project_score >= 80:
            project_match_label = "High"
        elif ev.project_score >= 50:
            project_match_label = "Med"

        # Latest shortlist status from already-loaded relation (no extra query)
        latest_sl: Optional[str] = None
        if ev.shortlists:
            latest_sl = max(ev.shortlists, key=lambda s: s.changed_at).status

        # Compute missed top-level requirements (GitHub prime requirement)
        missed_requirements: list[str] = []
        if ev.job_role and getattr(ev.job_role, "require_github", False):
            github_url = getattr(cand, "github_url", None) if cand else None
            if not github_url:
                missed_requirements.append("GitHub")

        items.append(
            ResultsResponse(
                evaluation_id=ev.id,
                candidate_id=cand.id if cand else 0,
                candidate_name=cand.name if cand else "Unknown",
                candidate_email=cand.email if cand else None,
                candidate_phone=getattr(cand, "phone", None) if cand else None,
                candidate_current_title=getattr(cand, "current_title", None) if cand else None,
                candidate_experience_level=getattr(cand, "experience_level", None) if cand else None,
                candidate_years_experience=getattr(cand, "years_experience", None) if cand else None,
                candidate_graduation_year=getattr(cand, "graduation_year", None) if cand else None,
                resume_id=ev.resume_id,
                total_score=ev.total_score,
                project_score=ev.project_score,
                skill_score=ev.skill_score,
                education_score=ev.education_score,
                experience_score=getattr(ev, "experience_score", 0.0) or 0.0,
                skills_matched=len(skills_matched_list),
                skills_total=skills_total_map.get(ev.job_role_id, 0),
                project_match_score=ev.project_score / 100.0,
                project_match_label=project_match_label,
                status=(
                    "rejected" if ev.stage == "rejected"
                    else "hired" if ev.stage == "hired"
                    else latest_sl
                    if latest_sl
                    else "review" if (cand and cand.needs_manual_review)
                    else "rejected" if ev.eval_status in ("tfidf_filtered", "experience_filtered")
                    else "pending"
                ),
                needs_manual_review=cand.needs_manual_review if cand else False,
                evaluated_at=ev.evaluated_at,
                email_sent_at=ev.email_sent_at,
                email_opened_at=getattr(ev, 'email_opened_at', None),
                job_role_id=ev.job_role_id,
                job_role_title=ev.job_role.title if ev.job_role else "",
                matched_skill_names=[
                    m["skill_name"] for m in skills_matched_list
                    if isinstance(m, dict) and "skill_name" in m
                ],
                candidate_stage=ev.stage or "applied",
                tfidf_score=getattr(ev, "tfidf_score", None),
                filter_stage=(
                    "experience_filtered" if ev.eval_status == "experience_filtered"
                    else "tfidf_filtered" if ev.eval_status == "tfidf_filtered"
                    else "llm_scored"
                ),
                github_skill_gap_severity=next(
                    (f.get("severity") for f in _parse_json_list(cand.consistency_flags if cand else None)
                     if f.get("flag_type") == "github_skill_gap"),
                    None,
                ),
                missed_requirements=missed_requirements,
                github_url=getattr(cand, "github_url", None) if cand else None,
                candidate_location=getattr(cand, "location", None) if cand else None,
            )
        )

    return PaginatedResults(items=items, total=total, page=page, limit=limit, pages=pages)


# ---------------------------------------------------------------------------
# Full-text resume search
# ---------------------------------------------------------------------------

class ResumeSearchHit(BaseModel):
    evaluation_id: int
    candidate_id: int
    candidate_name: str
    candidate_email: Optional[str]
    job_role_title: str
    total_score: float
    snippet: str   # excerpt around the match

class ResumeSearchResponse(BaseModel):
    hits: List[ResumeSearchHit]
    total: int

@router.get("/search", response_model=ResumeSearchResponse)
def search_resumes(
    q: str = Query(..., min_length=2, max_length=200, description="Text to search in resume content"),
    job_role_id: Optional[int] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResumeSearchResponse:
    """Full-text search across resume raw_text using ILIKE."""
    pattern = f"%{q}%"
    query = (
        db.query(Evaluation)
        .join(Resume, Resume.id == Evaluation.resume_id)
        .options(
            joinedload(Evaluation.resume)
            .joinedload(Resume.version)
            .joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.job_role),
        )
        .filter(
            Evaluation.eval_status.is_(None),
            Resume.raw_text.ilike(pattern),
        )
    )
    if job_role_id is not None:
        query = query.filter(Evaluation.job_role_id == job_role_id)

    total = query.count()
    evals = query.order_by(Evaluation.total_score.desc()).offset((page - 1) * limit).limit(limit).all()

    hits: List[ResumeSearchHit] = []
    q_lower = q.lower()
    for ev in evals:
        rv = ev.resume.version if ev.resume else None
        cand = rv.candidate if rv else None
        raw = ev.resume.raw_text or "" if ev.resume else ""

        # Build a ~200-char snippet centred around the first match
        idx = raw.lower().find(q_lower)
        if idx >= 0:
            start = max(0, idx - 80)
            end = min(len(raw), idx + len(q) + 120)
            snippet = ("…" if start > 0 else "") + raw[start:end].strip() + ("…" if end < len(raw) else "")
        else:
            snippet = raw[:200] + ("…" if len(raw) > 200 else "")

        hits.append(ResumeSearchHit(
            evaluation_id=ev.id,
            candidate_id=cand.id if cand else 0,
            candidate_name=cand.name if cand else "Unknown",
            candidate_email=cand.email if cand else None,
            job_role_title=ev.job_role.title if ev.job_role else "",
            total_score=ev.total_score,
            snippet=snippet,
        ))

    return ResumeSearchResponse(hits=hits, total=total)


@router.get("/{evaluation_id:int}", response_model=EvaluationDetail)
def get_result(
    evaluation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EvaluationDetail:
    """Full breakdown for an evaluation: skills, excerpts, confidence tiers."""
    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.job_role),
            joinedload(Evaluation.shortlists),
        )
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Evaluation {evaluation_id} not found")

    # Resolve candidate (was undefined bug — now via eager-loaded relations)
    rv: Optional[ResumeVersion] = ev.resume.version if ev.resume else None
    cand: Optional[Candidate] = rv.candidate if rv else None

    # Parse skills_matched JSON
    skills_matched: List[SkillMatchDetail] = []
    if ev.skills_matched:
        try:
            raw = json.loads(ev.skills_matched)
            skills_matched = [SkillMatchDetail(**s) for s in raw]
        except Exception:
            logger.warning("Failed to parse skills_matched for evaluation %d", evaluation_id)

    # Excerpts
    excerpts: List[str] = []
    if ev.excerpts:
        try:
            excerpts = json.loads(ev.excerpts)
        except (json.JSONDecodeError, ValueError):
            pass

    # Screening/knockout question answers
    screening_answers: List[ScreeningAnswerOut] = []
    if ev.screening_answers:
        try:
            screening_answers = [ScreeningAnswerOut(**a) for a in json.loads(ev.screening_answers)]
        except Exception:
            logger.warning("Failed to parse screening_answers for evaluation %d", evaluation_id)

    # Skill gaps: required skills not matched
    jrs_rows = (
        db.query(JobRoleSkill)
        .filter(JobRoleSkill.job_role_id == ev.job_role_id)
        .all()
    )
    skill_ids = [j.skill_id for j in jrs_rows]
    required_skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
    matched_names = {sm.skill_name.lower() for sm in skills_matched}
    skill_gaps = [s.name for s in required_skills if s.name.lower() not in matched_names]

    # Confidence tiers
    confidence_tiers: dict = {"high": [], "medium": [], "low": []}
    for sm in skills_matched:
        if sm.confidence >= 1.0:
            confidence_tiers["high"].append(sm.skill_name)
        elif sm.confidence >= 0.75:
            confidence_tiers["medium"].append(sm.skill_name)
        else:
            confidence_tiers["low"].append(sm.skill_name)

    # Resume text and sections
    resume_text: str = ev.resume.raw_text or "" if ev.resume else ""
    resume_sections: list = []
    if ev.resume and ev.resume.sections:
        try:
            resume_sections = json.loads(ev.resume.sections)
        except (json.JSONDecodeError, ValueError):
            pass

    # Latest shortlist status + note from eager-loaded relation
    latest_status: Optional[str] = None
    latest_note: Optional[str] = None
    if ev.shortlists:
        latest_sl = max(ev.shortlists, key=lambda s: s.changed_at)
        latest_status = latest_sl.status
        latest_note = latest_sl.note

    # Requirements breakdown (populated when requirements-mode scoring was used)
    requirements_breakdown: list = []
    if ev.requirements_breakdown:
        try:
            requirements_breakdown = [
                RequirementBreakdown(**r) for r in json.loads(ev.requirements_breakdown)
            ]
        except Exception:
            logger.warning("Failed to parse requirements_breakdown for evaluation %d", evaluation_id)

    # Derive the display status the same way the list endpoint does so the
    # detail page badge always matches what the leaderboard shows.
    derived_status: str = (
        "rejected" if (cand and cand.stage == "rejected")
        else "hired" if (cand and cand.stage == "hired")
        else latest_status
        if latest_status
        else "review" if (cand and cand.needs_manual_review)
        else "rejected" if ev.eval_status in ("tfidf_filtered", "experience_filtered")
        else "pending"
    )

    return EvaluationDetail(
        id=ev.id,
        resume_id=ev.resume_id,
        candidate_id=cand.id if cand else 0,
        candidate_name=cand.name if cand else "Unknown",
        candidate_email=cand.email if cand else None,
        job_role_id=ev.job_role_id,
        job_role_title=ev.job_role.title if ev.job_role else "Unknown",
        total_score=ev.total_score,
        project_score=ev.project_score,
        skill_score=ev.skill_score,
        education_score=ev.education_score,
        experience_score=getattr(ev, "experience_score", 0.0) or 0.0,
        evaluated_at=ev.evaluated_at,
        skills_matched=skills_matched,
        skill_gaps=skill_gaps,
        excerpts=excerpts,
        resume_text=resume_text,
        resume_sections=resume_sections,
        status=derived_status,
        shortlist_status=latest_status,
        notes=latest_note,
        confidence_tiers=confidence_tiers,
        requirements_breakdown=requirements_breakdown,
        reasoning_summary=ev.reasoning_summary,
        interview_questions=_parse_json_list(ev.interview_questions),
        email_sent_at=ev.email_sent_at,
        email_opened_at=getattr(ev, 'email_opened_at', None),
        github_url=cand.github_url if cand else None,
        linkedin_url=cand.linkedin_url if cand else None,
        portfolio_url=cand.portfolio_url if cand else None,
        tfidf_score=ev.tfidf_score,
        cover_letter=ev.cover_letter,
        screening_answers=screening_answers,
        knockout_failed=ev.knockout_failed,
        tags=_parse_json_list(getattr(cand, "tags", None)) if cand else [],
    )


@router.get("/employee-emails")
def get_employee_emails(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list:
    """Return merged list of system users + AD/LDAP-synced employees for CC/BCC autocomplete."""
    results = []
    seen_emails: set = set()

    # System users first
    for u in db.query(User.id, User.email).filter(User.is_active == True).order_by(User.email).all():
        results.append({"id": f"u_{u.id}", "email": u.email, "name": None, "type": "user"})
        seen_emails.add(u.email.lower())

    # AD/LDAP synced employees (skip duplicates already in users)
    for emp in db.query(OrgEmployee).order_by(OrgEmployee.display_name).all():
        if emp.email.lower() not in seen_emails:
            results.append({"id": f"oe_{emp.id}", "email": emp.email, "name": emp.display_name, "type": "user"})
            seen_emails.add(emp.email.lower())

    return results


@router.post("/{evaluation_id:int}/email", status_code=status.HTTP_202_ACCEPTED)
def send_email_to_candidate(
    evaluation_id: int,
    subject: str = Form(...),
    body: str = Form(...),
    meeting_link: Optional[str] = Form(default=None),
    meeting_cta_label: Optional[str] = Form(default="Join Meeting"),
    generate_qr: bool = Form(default=False),
    files: Optional[List[UploadFile]] = File(default=None),
    cc: Optional[str] = Form(default=None),
    bcc: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_send_emails")),
) -> dict:
    """Send a custom email (with optional meeting link and file attachments) to the candidate."""
    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.resume)
                 .joinedload(Resume.version)
                 .joinedload(ResumeVersion.candidate))
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Evaluation {evaluation_id} not found")

    rv = ev.resume.version if ev.resume else None
    cand = rv.candidate if rv else None

    if not cand or not cand.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Candidate email not found")

    # Read uploaded files (max 5, max 10 MB total)
    from app.services.email import send_manual_email, _plain_to_html, _generate_qr_data_uri, AttachmentTuple
    from app.models import _utcnow

    attachments: List[AttachmentTuple] = []
    if files:
        total_bytes = 0
        for f in files[:5]:
            data = f.file.read()
            total_bytes += len(data)
            if total_bytes > 10 * 1024 * 1024:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                    detail="Total attachment size exceeds 10 MB")
            attachments.append((f.filename or "attachment", data, f.content_type or "application/octet-stream"))

    # Build styled HTML unconditionally so that newlines are properly wrapped in <p> tags
    qr_uri = _generate_qr_data_uri(meeting_link) if (generate_qr and meeting_link) else None
    html: Optional[str] = _plain_to_html(
        body,
        subtitle="Recruitment Team",
        meeting_link=meeting_link,
        meeting_cta_label=meeting_cta_label or "Join Meeting",
        qr_data_uri=qr_uri,
    )

    import re
    cc_list = [e.strip() for e in re.split(r'[,;\s]+', cc) if e.strip()] if cc else None
    bcc_list = [e.strip() for e in re.split(r'[,;\s]+', bcc) if e.strip()] if bcc else None

    try:
        send_manual_email(
            cand.email, cand.name, subject, body,
            html=html,
            attachments=attachments or None,
            cc=cc_list or None,
            bcc=bcc_list or None,
        )
        ev.email_sent_at = _utcnow()
        record_audit(db, current_user.id, "manual_email_sent", "evaluation", evaluation_id,
                     {"candidate_email": cand.email, "subject": subject, "cc": cc_list, "bcc": bcc_list})
        db.commit()
        return {"status": "success", "message": "Email sent"}
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", cand.email, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to send email") from exc


@router.post("/{evaluation_id:int}/send-rejection", status_code=status.HTTP_202_ACCEPTED)
def send_rejection_email(
    evaluation_id: int,
    body: RejectionEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_send_emails")),
) -> dict:
    """Send a constructive rejection email with skill gap feedback to the candidate."""
    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.resume)
                 .joinedload(Resume.version)
                 .joinedload(ResumeVersion.candidate),
                 joinedload(Evaluation.job_role))
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Evaluation {evaluation_id} not found")

    rv = ev.resume.version if ev.resume else None
    cand = rv.candidate if rv else None

    if not cand or not cand.email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Candidate email not found")

    # Parse skill gaps from stored skills_matched vs job role skills
    skill_gaps: List[str] = []
    try:
        jrs_rows = db.query(JobRoleSkill).filter(JobRoleSkill.job_role_id == ev.job_role_id).all()
        skill_ids = [j.skill_id for j in jrs_rows]
        required_skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
        matched_names: set = set()
        if ev.skills_matched:
            matched_names = {s["skill_name"].lower() for s in json.loads(ev.skills_matched)}
        skill_gaps = [s.name for s in required_skills if s.name.lower() not in matched_names]
    except Exception:
        pass

    from app.services.email import CandidateEmailService
    try:
        sent = CandidateEmailService.send_rejection(
            candidate_email=cand.email,
            candidate_name=cand.name,
            job_role_title=ev.job_role.title if ev.job_role else "the role",
            skill_gaps=skill_gaps[:5],
            note=body.note,
            filter_reason=getattr(ev, "eval_status", None),
        )
        if not sent:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                detail="SMTP not configured — rejection email not sent")
        record_audit(db, current_user.id, "rejection_email_sent", "evaluation", evaluation_id,
                     {"candidate_email": cand.email})
        db.commit()
        return {"status": "success", "message": "Rejection email sent"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to send rejection email to %s: %s", cand.email, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to send rejection email") from exc


@router.delete("/all", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_all_results(
    job_role_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete all evaluation results for a specific job role."""
    try:
        # Bulk query.delete() bypasses ORM cascade, so explicitly delete
        # child Shortlist rows first to avoid FK constraint violations.
        eval_ids = [
            row[0] for row in
            db.query(Evaluation.id).filter(Evaluation.job_role_id == job_role_id).all()
        ]
        if eval_ids:
            # Find candidate emails linked to these evaluations
            emails = [
                row[0] for row in
                db.query(Candidate.email)
                .join(ResumeVersion, ResumeVersion.candidate_id == Candidate.id)
                .join(Resume, Resume.id == ResumeVersion.id)
                .join(Evaluation, Evaluation.resume_id == Resume.id)
                .filter(Evaluation.id.in_(eval_ids))
                .all()
                if row[0]
            ]
            if emails:
                # Delete corresponding InboundEmail logs
                db.query(InboundEmail).filter(
                    InboundEmail.sender_email.in_(emails)
                ).delete(synchronize_session=False)

            db.query(Shortlist).filter(
                Shortlist.evaluation_id.in_(eval_ids)
            ).delete(synchronize_session=False)
        db.query(Evaluation).filter(
            Evaluation.job_role_id == job_role_id
        ).delete(synchronize_session=False)
        record_audit(db, current_user.id, "evaluations_bulk_deleted", "job_role", job_role_id,
                     {"count": len(eval_ids)})
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to delete results for job_role_id=%d: %s", job_role_id, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to delete results") from exc


@router.delete("/{evaluation_id:int}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_result(
    evaluation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete an individual evaluation result."""
    ev = db.query(Evaluation).filter(Evaluation.id == evaluation_id).first()
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Result not found")
    try:
        # Find candidate email associated with this evaluation
        candidate_email = (
            db.query(Candidate.email)
            .join(ResumeVersion, ResumeVersion.candidate_id == Candidate.id)
            .join(Resume, Resume.id == ResumeVersion.id)
            .join(Evaluation, Evaluation.resume_id == Resume.id)
            .filter(Evaluation.id == evaluation_id)
            .scalar()
        )
        if candidate_email:
            # Delete corresponding InboundEmail log
            db.query(InboundEmail).filter(
                InboundEmail.sender_email == candidate_email
            ).delete(synchronize_session=False)

        # Delete related shortlists first to avoid FK constraint violations
        db.query(Shortlist).filter(
            Shortlist.evaluation_id == evaluation_id
        ).delete(synchronize_session=False)
        record_audit(db, current_user.id, "evaluation_deleted", "evaluation", evaluation_id)
        db.delete(ev)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to delete result") from exc


class BulkDeleteRequest(BaseModel):
    ids: List[int]


@router.post("/bulk-delete", status_code=status.HTTP_200_OK)
def bulk_delete_results(
    body: BulkDeleteRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(require_permission("can_delete")),
) -> dict:
    """Delete multiple evaluation results in a single transaction."""
    if not body.ids:
        return {"deleted": 0}
    try:
        # Find candidate emails linked to these evaluations
        emails = [
            row[0] for row in
            db.query(Candidate.email)
            .join(ResumeVersion, ResumeVersion.candidate_id == Candidate.id)
            .join(Resume, Resume.id == ResumeVersion.id)
            .join(Evaluation, Evaluation.resume_id == Resume.id)
            .filter(Evaluation.id.in_(body.ids))
            .all()
            if row[0]
        ]
        if emails:
            # Delete corresponding InboundEmail logs
            db.query(InboundEmail).filter(
                InboundEmail.sender_email.in_(emails)
            ).delete(synchronize_session=False)

        db.query(Shortlist).filter(
            Shortlist.evaluation_id.in_(body.ids)
        ).delete(synchronize_session=False)
        deleted = db.query(Evaluation).filter(
            Evaluation.id.in_(body.ids)
        ).delete(synchronize_session=False)
        record_audit(db, _current_user.id, "evaluations_bulk_deleted", "evaluation", None,
                     {"ids": body.ids, "count": deleted})
        db.commit()
        return {"deleted": deleted}
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Bulk delete failed",
        ) from exc


@router.patch("/{evaluation_id:int}/sections", status_code=status.HTTP_200_OK)
def update_resume_sections(
    evaluation_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Persist user-corrected section types back to resume.sections JSON."""
    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.resume))
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    if ev.resume is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No resume attached")

    sections = body.get("sections", [])
    if not isinstance(sections, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="sections must be a list")

    # Validate and sanitise each section dict
    allowed_types = {
        "projects", "work_experience", "experience", "skills_section",
        "skills", "education", "certifications", "summary", "objective",
        "awards", "publications", "volunteer", "languages", "interests", "unknown",
    }
    cleaned: list[dict] = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        sec_type = sec.get("type", "unknown")
        if sec_type not in allowed_types:
            sec_type = "unknown"
        cleaned.append({**sec, "type": sec_type})

    try:
        ev.resume.sections = json.dumps(cleaned)
        record_audit(db, current_user.id, "resume_sections_updated", "evaluation", evaluation_id,
                     {"section_count": len(cleaned)})
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("Failed to save sections for evaluation %d: %s", evaluation_id, exc)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to save sections") from exc

    return {"saved": len(cleaned)}


@router.post("/{evaluation_id:int}/reclassify-and-rescore", status_code=status.HTTP_202_ACCEPTED)
def reclassify_and_rescore(
    evaluation_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Re-run the segmenter on stored resume text, save new section types,
    and trigger background re-scoring so scores update automatically."""
    from app.services.segmenter import detect_sections
    from app.routers.evaluate import _run_evaluation
    from app.services.scorer import ScoringWeights

    ev: Optional[Evaluation] = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.resume), joinedload(Evaluation.job_role))
        .filter(Evaluation.id == evaluation_id)
        .first()
    )
    if ev is None:
        raise HTTPException(status_code=404, detail="Evaluation not found")
    if ev.resume is None or not ev.resume.raw_text:
        raise HTTPException(status_code=400, detail="No resume text available for re-classification")

    sections = detect_sections(ev.resume.raw_text)
    sections_data = [
        {
            "type": s.type,
            "title": s.title,
            "start_line": s.start_line,
            "end_line": s.end_line,
            "text": s.text,
            "confidence": s.confidence,
        }
        for s in sections
    ]
    ev.resume.sections = json.dumps(sections_data)
    record_audit(db, current_user.id, "reclassify_rescore", "evaluation", evaluation_id,
                 {"section_count": len(sections_data)})
    db.commit()

    # Build weights from job role config then re-score in background
    jr = ev.job_role
    weights = ScoringWeights(
        projects=float(getattr(jr, "weight_projects", None) or 0.45),
        skills=float(getattr(jr, "weight_skills", None) or 0.35),
        education=float(getattr(jr, "weight_education", None) or 0.20),
    ) if jr else None

    background_tasks.add_task(_run_evaluation, ev.resume_id, ev.job_role_id, weights, db)

    return {"sections": len(sections_data), "message": "Re-classified; re-scoring started in background"}


@router.patch("/evaluations/{evaluation_id}/stage", status_code=status.HTTP_200_OK)
def update_evaluation_stage(
    evaluation_id: int,
    body: UpdateCandidateStageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Update the hiring pipeline stage for one application (evaluation).

    Also dual-writes Candidate.stage (a derived "last-moved" convenience
    column) so non-job-scoped views keep showing a reasonable value.
    """
    ev = db.query(Evaluation).filter(Evaluation.id == evaluation_id).first()
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    try:
        ev.stage = body.stage
        cand = ev.resume.version.candidate if ev.resume and ev.resume.version else None
        if cand is not None:
            cand.stage = body.stage
        record_audit(db, current_user.id, "evaluation_stage_updated", "evaluation", evaluation_id,
                     {"stage": body.stage, "candidate_id": cand.id if cand else None})
        db.commit()
        return {"evaluation_id": evaluation_id, "stage": body.stage}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to update stage") from exc


class BulkStageRequest(BaseModel):
    evaluation_ids: List[int]
    stage: str = Field(..., pattern="^(applied|screening|coding|interview|offer|hired|rejected)$")


@router.post("/bulk-stage", status_code=status.HTTP_200_OK)
def bulk_update_stage(
    body: BulkStageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Move multiple applications (evaluations) to a new pipeline stage in one transaction.

    Dual-writes Candidate.stage per evaluation, same as the single-evaluation endpoint.
    """
    if not body.evaluation_ids:
        return {"updated": 0}
    evaluations = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate))
        .filter(Evaluation.id.in_(body.evaluation_ids))
        .all()
    )
    try:
        updated = 0
        for ev in evaluations:
            ev.stage = body.stage
            cand = ev.resume.version.candidate if ev.resume and ev.resume.version else None
            if cand is not None:
                cand.stage = body.stage
            updated += 1
        record_audit(db, current_user.id, "evaluations_bulk_stage_updated", "evaluation", None,
                     {"evaluation_ids": body.evaluation_ids, "stage": body.stage, "count": updated})
        db.commit()
        return {"updated": updated, "stage": body.stage}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Bulk stage update failed") from exc


@router.patch("/candidates/{candidate_id}/stage", status_code=status.HTTP_200_OK, deprecated=True)
def update_candidate_stage(
    candidate_id: int,
    body: UpdateCandidateStageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Deprecated: use PATCH /results/evaluations/{evaluation_id}/stage instead.

    Resolves to the candidate's most recently evaluated application, for
    backward compatibility with callers not yet updated (e.g. SharePoint sync).
    """
    logger.warning("Deprecated PATCH /candidates/%s/stage called — migrate to /evaluations/{id}/stage", candidate_id)
    cand = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if cand is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    ev = (
        db.query(Evaluation)
        .join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
        .filter(ResumeVersion.candidate_id == candidate_id)
        .order_by(Evaluation.evaluated_at.desc())
        .first()
    )
    try:
        cand.stage = body.stage
        if ev is not None:
            ev.stage = body.stage
        record_audit(db, current_user.id, "candidate_stage_updated", "candidate", candidate_id,
                     {"stage": body.stage})
        db.commit()
        return {"candidate_id": candidate_id, "stage": body.stage}
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to update stage") from exc


class ScheduleInterviewRequest(BaseModel):
    interview_scheduled_at: Optional[str] = None   # ISO8601 datetime string; null to clear
    interview_link: Optional[str] = None           # Zoom/Meet/Teams URL; null to clear


@router.patch("/{evaluation_id:int}/schedule-interview", status_code=status.HTTP_200_OK)
def schedule_interview(
    evaluation_id: int,
    body: ScheduleInterviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Set or clear the interview date/time and video call link for an evaluation."""
    from datetime import datetime as dt
    ev = db.query(Evaluation).filter(Evaluation.id == evaluation_id).first()
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evaluation not found")
    try:
        if body.interview_scheduled_at:
            ev.interview_scheduled_at = dt.fromisoformat(body.interview_scheduled_at.replace("Z", "+00:00"))
        else:
            ev.interview_scheduled_at = None
        ev.interview_link = body.interview_link or None
        record_audit(db, current_user.id, "interview_scheduled", "evaluation", evaluation_id,
                     {"scheduled_at": body.interview_scheduled_at, "link": body.interview_link})
        db.commit()
        return {
            "evaluation_id": evaluation_id,
            "interview_scheduled_at": ev.interview_scheduled_at.isoformat() if ev.interview_scheduled_at else None,
            "interview_link": ev.interview_link,
        }
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to schedule interview") from exc


@router.get("/compare-analysis")
def compare_candidates_analysis(
    a: int = Query(..., description="Evaluation ID of Candidate A"),
    b: int = Query(..., description="Evaluation ID of Candidate B"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Compare two candidate evaluations and generate AI fit analysis."""
    from app.models import Evaluation, Candidate, JobRole
    import json

    ev_a = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume)
            .joinedload(Resume.version)
            .joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.job_role)
        )
        .filter(Evaluation.id == a)
        .first()
    )
    ev_b = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume)
            .joinedload(Resume.version)
            .joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.job_role)
        )
        .filter(Evaluation.id == b)
        .first()
    )

    if not ev_a or not ev_b:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or both evaluations not found"
        )

    rv_a = ev_a.resume.version if ev_a.resume else None
    cand_a = rv_a.candidate if rv_a else None

    rv_b = ev_b.resume.version if ev_b.resume else None
    cand_b = rv_b.candidate if rv_b else None

    name_a = cand_a.name if cand_a else "Candidate A"
    name_b = cand_b.name if cand_b else "Candidate B"

    skills_a_list = json.loads(ev_a.skills_matched) if ev_a.skills_matched else []
    skills_b_list = json.loads(ev_b.skills_matched) if ev_b.skills_matched else []

    skills_a = [s["skill_name"] for s in skills_a_list if isinstance(s, dict) and "skill_name" in s]
    skills_b = [s["skill_name"] for s in skills_b_list if isinstance(s, dict) and "skill_name" in s]

    common_skills = list(set(skills_a) & set(skills_b))
    only_a = list(set(skills_a) - set(skills_b))
    only_b = list(set(skills_b) - set(skills_a))

    def _compute_skill_gaps(ev) -> list:
        try:
            jrs_rows = db.query(JobRoleSkill).filter(JobRoleSkill.job_role_id == ev.job_role_id).all()
            skill_ids = [j.skill_id for j in jrs_rows]
            required_skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()
            matched_raw = json.loads(ev.skills_matched) if ev.skills_matched else []
            matched_names = {s["skill_name"].lower() for s in matched_raw if isinstance(s, dict) and "skill_name" in s}
            return [s.name for s in required_skills if s.name.lower() not in matched_names]
        except Exception:
            return []

    gaps_a = _compute_skill_gaps(ev_a)
    gaps_b = _compute_skill_gaps(ev_b)

    role_title = ev_a.job_role.title if ev_a.job_role else "Target Role"

    exp_a = f"{cand_a.years_experience} years" if cand_a and cand_a.years_experience is not None else "Not specified"
    exp_b = f"{cand_b.years_experience} years" if cand_b and cand_b.years_experience is not None else "Not specified"

    # ── GitHub enrichment ────────────────────────────────────────────────────
    github_url_a = (cand_a.github_url or "") if cand_a else ""
    github_url_b = (cand_b.github_url or "") if cand_b else ""

    # Fetch live GitHub data if stored summary is absent and a URL exists
    def _fetch_live_github(cand) -> dict:
        url = (cand.github_url or "") if cand else ""
        if not url:
            return {}
        try:
            from app.services.github_analyzer import analyze_github_profile
            job_skills = skills_a if cand == cand_a else skills_b
            return analyze_github_profile(url, job_skills) or {}
        except Exception:
            return {}

    _live_a: dict = {}
    _live_b: dict = {}
    if cand_a and not cand_a.github_summary and github_url_a:
        _live_a = _fetch_live_github(cand_a)
    if cand_b and not cand_b.github_summary and github_url_b:
        _live_b = _fetch_live_github(cand_b)

    def _github_summary_text(cand, live_data: dict = None) -> str:
        raw_summary = None
        if cand and cand.github_summary:
            raw_summary = cand.github_summary
        elif live_data:
            raw_summary = json.dumps(live_data)
        if not raw_summary:
            return "No GitHub data available."
        try:
            gh = json.loads(raw_summary) if isinstance(raw_summary, str) else raw_summary
            if not isinstance(gh, dict):
                return "No GitHub data available."
            # If GitHub returned an error (e.g. user not found), report it gracefully
            if gh.get("error"):
                return f"GitHub: {gh['error']}"
            parts = []
            if gh.get("public_repos") is not None:
                parts.append(f"{gh['public_repos']} public repos")
            if gh.get("total_stars") is not None:
                parts.append(f"{gh['total_stars']} total stars")
            if gh.get("followers") is not None:
                parts.append(f"{gh['followers']} followers")
            # 'languages' is a list of {"language": ..., "repo_count": ...} dicts
            langs_raw = gh.get("languages") or gh.get("top_languages")
            if langs_raw:
                if isinstance(langs_raw, list):
                    lang_names = [
                        (l["language"] if isinstance(l, dict) else l)
                        for l in langs_raw[:5]
                        if l
                    ]
                    if lang_names:
                        parts.append(f"top languages: {', '.join(lang_names)}")
                elif isinstance(langs_raw, dict):
                    sorted_langs = sorted(langs_raw.items(), key=lambda x: x[1], reverse=True)
                    parts.append(f"top languages: {', '.join([l for l, _ in sorted_langs[:5]])}")
            if gh.get("pinned_repos"):
                pinned = [
                    (r.get("name", r) if isinstance(r, dict) else r)
                    for r in gh["pinned_repos"][:3]
                ]
                parts.append(f"notable projects: {', '.join(str(p) for p in pinned)}")
            if gh.get("relevant_repos"):
                rel = [r.get("name", "") for r in gh["relevant_repos"][:3] if isinstance(r, dict)]
                if rel:
                    parts.append(f"relevant repos: {', '.join(rel)}")
            if gh.get("activity_score") is not None:
                parts.append(f"activity score: {gh['activity_score']}/100")
            # 'inferred_skills' is a list of {"name": ..., "source": ..., "evidence": [...]} dicts
            if gh.get("inferred_skills"):
                inferred = [
                    (s["name"] if isinstance(s, dict) else s)
                    for s in gh["inferred_skills"][:5]
                    if s
                ]
                if inferred:
                    parts.append(f"inferred skills: {', '.join(str(i) for i in inferred)}")
            if gh.get("has_readme"):
                parts.append("has profile README")
            discrepancies = gh.get("discrepancies") or []
            if discrepancies:
                parts.append(f"⚠ discrepancies: {'; '.join(str(d) for d in discrepancies[:2])}")
            return "; ".join(parts) if parts else "GitHub profile exists but no metrics available."
        except Exception as exc:
            import logging as _logging
            _logging.getLogger(__name__).warning("GitHub summary parse failed: %s | data: %.200s", exc, raw_summary)
            return "No GitHub data available."

    github_a = _github_summary_text(cand_a, _live_a)
    github_b = _github_summary_text(cand_b, _live_b)

    # ── Project analysis ────────────────────────────────────────────────────
    def _project_text(ev) -> str:
        label = getattr(ev, "project_match_label", None)
        if label:
            return f"Project alignment: {label}"
        return "Project alignment: Not assessed"

    proj_a = _project_text(ev_a)
    proj_b = _project_text(ev_b)

    # ── Education ────────────────────────────────────────────────────────────
    grad_a = f"Graduation year: {cand_a.graduation_year}" if cand_a and cand_a.graduation_year else ""
    grad_b = f"Graduation year: {cand_b.graduation_year}" if cand_b and cand_b.graduation_year else ""

    # best_pick_name and score_diff are resolved after LLM parsing (or deterministic fallback)
    best_pick_name = None
    score_diff = None

    # ── AI Prompt Construction ───────────────────────────────────────────────
    # Sort candidates alphabetically by name so the prompt is identical regardless
    # of which ID was passed as 'a' vs 'b', eliminating LLM position bias.
    _prompt_cands = sorted([
        dict(name=name_a, score=ev_a.total_score, skills=skills_a, only=only_a,
             exp=exp_a, proj=proj_a, grad=grad_a, gaps=gaps_a,
             gh_url=github_url_a, gh=github_a),
        dict(name=name_b, score=ev_b.total_score, skills=skills_b, only=only_b,
             exp=exp_b, proj=proj_b, grad=grad_b, gaps=gaps_b,
             gh_url=github_url_b, gh=github_b),
    ], key=lambda c: c["name"].lower())
    p1, p2 = _prompt_cands

    prompt = f"""You are a professional HR executive and expert technical recruiter.
Compare these two candidates for the role of '{role_title}' and generate a highly professional, scannable comparative review detailing who is the best fit and why.

{p1['name']}:
- Fit Score: {p1['score']:.1f}/100
- Matched Skills ({len(p1['skills'])}): {', '.join(p1['skills']) if p1['skills'] else 'None'}
- Unique Skills: {', '.join(p1['only']) if p1['only'] else 'None'}
- Years of Experience: {p1['exp']}
- {p1['proj']}
- {p1['grad']}
- Missed Requirements: {', '.join(p1['gaps']) if p1['gaps'] else 'None'}
- GitHub Profile: {p1['gh_url'] or 'Not provided'}
- GitHub Repositories & Activity: {p1['gh']}

{p2['name']}:
- Fit Score: {p2['score']:.1f}/100
- Matched Skills ({len(p2['skills'])}): {', '.join(p2['skills']) if p2['skills'] else 'None'}
- Unique Skills: {', '.join(p2['only']) if p2['only'] else 'None'}
- Years of Experience: {p2['exp']}
- {p2['proj']}
- {p2['grad']}
- Missed Requirements: {', '.join(p2['gaps']) if p2['gaps'] else 'None'}
- GitHub Profile: {p2['gh_url'] or 'Not provided'}
- GitHub Repositories & Activity: {p2['gh']}

Your comparative report MUST include ALL of the following sections:
1. **Executive Summary**: A brief comparison of both profiles.
2. **Key Strengths Comparison**: Contrast each candidate's unique technical and experience values.
3. **GitHub Repository & Portfolio Analysis**: Deep-dive into their repositories — compare languages used, activity scores, relevant projects, inferred skills from repos, open-source contributions, and README quality. If one candidate lacks a GitHub profile or has low activity, explicitly flag it as a significant disadvantage for technical roles.
4. **Common & Different Skills Analysis**: Explicitly discuss their technical alignment with the role requirements, noting which skills are demonstrated via GitHub vs. just listed on resume.
5. **🏆 Final Hiring Recommendation**: Boldly declare WHO IS THE BEST PICK with a clear name in bold — explain rigorously with data-driven reasoning (scores, repo activity, skill coverage) why this candidate outperforms the other for this specific role.

Write using clean, modern markdown (no code block ticks). Keep it concise, engaging, and professional.

After all your content, on a new line by itself, output exactly:
BEST_PICK: <the full name of the candidate you recommend>
Do not include this line anywhere else in your response."""

    analysis = None
    if settings.llm_api_key:
        try:
            from openai import OpenAI
            client = OpenAI(
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                timeout=settings.llm_timeout,
            )
            completion = client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": "You are an expert technical recruiting advisor. Always conclude with a definitive hiring recommendation naming the best candidate."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0,
            )
            import re as _re
            raw_analysis = completion.choices[0].message.content or ""
            # Parse and strip the trailing BEST_PICK metadata line
            _lines = raw_analysis.splitlines()
            for _i in range(len(_lines) - 1, -1, -1):
                _line = _lines[_i].strip()
                if _line.startswith("BEST_PICK:"):
                    _raw_pick = _line[len("BEST_PICK:"):].strip()
                    _clean_pick = _re.sub(r'[*_`]', '', _raw_pick).strip()
                    if name_a.lower() in _clean_pick.lower() or _clean_pick.lower() in name_a.lower():
                        best_pick_name = name_a
                        score_diff = ev_a.total_score - ev_b.total_score
                    elif name_b.lower() in _clean_pick.lower() or _clean_pick.lower() in name_b.lower():
                        best_pick_name = name_b
                        score_diff = ev_b.total_score - ev_a.total_score
                    raw_analysis = "\n".join(_lines[:_i]).rstrip()
                    break
            analysis = raw_analysis or None
        except Exception as exc:
            logger.warning("Comparison AI LLM call failed: %s", exc)

    # Deterministic fallback if LLM not configured or fails
    if not analysis:
        winner = name_a if ev_a.total_score >= ev_b.total_score else name_b
        winner_score = ev_a.total_score if ev_a.total_score >= ev_b.total_score else ev_b.total_score
        loser = name_b if ev_a.total_score >= ev_b.total_score else name_a
        loser_score = ev_b.total_score if ev_a.total_score >= ev_b.total_score else ev_a.total_score
        winner_github = github_a if ev_a.total_score >= ev_b.total_score else github_b

        analysis = f"""#### 1. Executive Summary
A structured side-by-side evaluation was conducted between **{name_a}** (Score: **{ev_a.total_score:.0f}/100**) and **{name_b}** (Score: **{ev_b.total_score:.0f}/100**) for the **{role_title}** position. Based on skill alignment, experience, project metrics, and GitHub activity, **{winner}** is the stronger candidate.

#### 2. Technical Profile Comparison
- **Experience**: {name_a} — **{exp_a}** | {name_b} — **{exp_b}**
- **Requirement Matching**: {name_a} matches **{len(skills_a)} skills** ({len(gaps_a)} gaps) | {name_b} matches **{len(skills_b)} skills** ({len(gaps_b)} gaps)
- **Projects**: {proj_a} | {proj_b}

#### 3. GitHub & Open-Source Activity
- **{name_a}**: {github_a}
- **{name_b}**: {github_b}

#### 4. Core Differences & Skill Gaps
- **Skills unique to {name_a}**: {', '.join([f'`{s}`' for s in only_a]) if only_a else 'None beyond matched set'}
- **Skills unique to {name_b}**: {', '.join([f'`{s}`' for s in only_b]) if only_b else 'None beyond matched set'}
- **Shared stack**: {', '.join([f'`{s}`' for s in common_skills]) if common_skills else 'No overlap'}

#### 🏆 5. Final Hiring Recommendation
**Best Pick: {winner}**

**{winner}** is the clear choice for **{role_title}** with a fit score of **{winner_score:.0f}/100** vs {loser}'s **{loser_score:.0f}/100** — a **{abs(winner_score - loser_score):.0f}-point advantage**. {winner} covers more of the required technical stack, demonstrates stronger project alignment, and shows {winner_github if winner_github != 'No GitHub data available.' else 'comparable open-source activity'}. While {loser} brings value, the skill gap differential and lower overall score indicate they are better suited for a junior variant of this position or would require greater onboarding investment.
"""

    # Fallback: LLM not configured, failed, or returned an unrecognised candidate name
    if best_pick_name is None:
        best_pick_name = name_a if ev_a.total_score >= ev_b.total_score else name_b
        score_diff = abs(ev_a.total_score - ev_b.total_score)

    return {
        "analysis": analysis,
        "common_skills": common_skills,
        "only_a": only_a,
        "only_b": only_b,
        "shared_count": len(common_skills),
        "only_a_count": len(only_a),
        "only_b_count": len(only_b),
        "best_pick_name": best_pick_name,
        "score_diff": round(score_diff, 1),
        "github_a": github_a,
        "github_b": github_b,
    }


# ---------------------------------------------------------------------------
# HRIS / ATS CSV export
# ---------------------------------------------------------------------------

@router.get("/export/csv")
def export_results_csv(
    job_role_id: Optional[int] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("can_export")),
) -> StreamingResponse:
    """Export ALL evaluated candidates to CSV — no page limit, all eval statuses included.

    Columns: candidate_name, email, phone, location, current_title, experience_level,
             years_experience, stage, eval_status, total_score, project_score, skill_score,
             education_score, recommendation, linkedin_url, github_url,
             portfolio_url, job_role, evaluated_at
    """
    q = (
        db.query(Evaluation)
        .join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .options(
            joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.shortlists),
        )
        .filter(
            ResumeVersion.is_current.is_(True),
            Candidate.deleted_at.is_(None),
            # Include all statuses: None (scored), tfidf_filtered, experience_filtered
            # Exclude only "queued" (not yet scored)
            Evaluation.eval_status.notin_(["queued"]),
        )
    )
    if job_role_id is not None:
        q = q.filter(Evaluation.job_role_id == job_role_id)

    # Optional shortlist status filter
    if status_filter:
        sub = (
            sa_select(Shortlist.evaluation_id)
            .where(Shortlist.status == status_filter)
            .distinct()
        )
        q = q.filter(Evaluation.id.in_(sub))

    # Optional name/email search
    if search:
        pattern = f"%{search}%"
        q = q.filter(
            or_(
                Candidate.name.ilike(pattern),
                Candidate.email.ilike(pattern),
            )
        )

    evals = q.order_by(Evaluation.total_score.desc()).all()

    # Resolve job role names in one query
    role_ids = list({ev.job_role_id for ev in evals if ev.job_role_id})
    role_map: dict[int, str] = {}
    if role_ids:
        for jr in db.query(JobRole).filter(JobRole.id.in_(role_ids)).all():
            role_map[jr.id] = jr.title

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "candidate_name", "email", "phone", "location", "current_title", "experience_level",
        "years_experience", "stage", "eval_status", "total_score", "project_score", "skill_score",
        "education_score", "recommendation", "linkedin_url", "github_url",
        "portfolio_url", "job_role", "evaluated_at",
    ])

    for ev in evals:
        try:
            cand = ev.resume.version.candidate if ev.resume and ev.resume.version else None
        except AttributeError:
            cand = None

        # Latest shortlist recommendation
        recommendation = ""
        if ev.shortlists:
            latest = max(ev.shortlists, key=lambda s: s.changed_at)
            recommendation = latest.status

        # Human-readable eval_status
        eval_status_label = {
            None: "scored",
            "tfidf_filtered": "auto_rejected_irrelevant",
            "experience_filtered": "auto_rejected_experience",
        }.get(ev.eval_status, ev.eval_status or "scored")

        writer.writerow([
            cand.name if cand else "",
            cand.email if cand else "",
            getattr(cand, "phone", "") or "" if cand else "",
            getattr(cand, "location", "") or "" if cand else "",
            getattr(cand, "current_title", "") or "" if cand else "",
            getattr(cand, "experience_level", "") or "" if cand else "",
            getattr(cand, "years_experience", "") if cand else "",
            ev.stage or (cand.stage if cand else ""),
            eval_status_label,
            round(ev.total_score, 1),
            round(ev.project_score, 1),
            round(ev.skill_score, 1),
            round(ev.education_score, 1),
            recommendation,
            cand.linkedin_url or "" if cand else "",
            cand.github_url or "" if cand else "",
            cand.portfolio_url or "" if cand else "",
            role_map.get(ev.job_role_id, "") if ev.job_role_id else "",
            ev.evaluated_at.strftime("%Y-%m-%d %H:%M") if ev.evaluated_at else "",
        ])

    output.seek(0)
    filename = f"candidates_export_{job_role_id or 'all'}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Summary stats — aggregated across ALL evaluations for a job role
# ---------------------------------------------------------------------------

@router.get("/summary")
def results_summary(
    job_role_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return aggregate stats for the stat cards — computed over ALL pages, not just the visible one."""
    base = (
        db.query(Evaluation)
        .join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .filter(
            ResumeVersion.is_current.is_(True),
            Candidate.deleted_at.is_(None),
            or_(
                Evaluation.eval_status.is_(None),
                Evaluation.eval_status == "tfidf_filtered",
                Evaluation.eval_status == "experience_filtered",
            ),
        )
    )
    if job_role_id is not None:
        base = base.filter(Evaluation.job_role_id == job_role_id)

    total: int = base.count()

    avg_score_row = base.with_entities(func.avg(Evaluation.total_score)).scalar()
    avg_score = round(float(avg_score_row), 1) if avg_score_row is not None else 0.0

    # Shortlisted: latest shortlist status = 'shortlisted'
    latest_sl_subq = (
        db.query(Shortlist.status)
        .filter(Shortlist.evaluation_id == Evaluation.id)
        .order_by(Shortlist.changed_at.desc())
        .limit(1)
        .correlate(Evaluation)
        .scalar_subquery()
    )
    shortlisted: int = base.filter(latest_sl_subq == "shortlisted").count()

    # since Candidate is already joined in base, we simply filter on the candidate field directly
    needs_review: int = base.filter(Candidate.needs_manual_review.is_(True)).count()
    tfidf_filtered: int = base.filter(Evaluation.eval_status == "tfidf_filtered").count()
    experience_filtered: int = base.filter(Evaluation.eval_status == "experience_filtered").count()

    # pending = no shortlist record + not flagged for review + not auto-rejected/queued
    has_shortlist_subq = (
        db.query(Shortlist.id)
        .filter(Shortlist.evaluation_id == Evaluation.id)
        .exists()
    )
    pending: int = base.filter(
        ~has_shortlist_subq,
        Candidate.needs_manual_review.is_(False),
        or_(
            Evaluation.eval_status.is_(None),
            Evaluation.eval_status.notin_(["tfidf_filtered", "experience_filtered", "queued"]),
        ),
    ).count()

    queued_q = (
        db.query(Evaluation)
        .join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
        .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
        .filter(
            Evaluation.eval_status == "queued",
            Candidate.deleted_at.is_(None),
        )
    )
    if job_role_id is not None:
        queued_q = queued_q.filter(Evaluation.job_role_id == job_role_id)
    queued: int = queued_q.count()

    return {
        "total": total,
        "avg_score": avg_score,
        "shortlisted": shortlisted,
        "needs_review": needs_review,
        "pending": pending,
        "tfidf_filtered": tfidf_filtered,
        "experience_filtered": experience_filtered,
        "queued": queued,
    }
