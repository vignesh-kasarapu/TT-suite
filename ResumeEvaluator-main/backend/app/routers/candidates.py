"""Candidate search endpoint — cross-role candidate lookup."""
from __future__ import annotations

import json
import logging
import math
import os
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_permission, require_staff
from app.models import Candidate, Evaluation, JobRole, Resume, ResumeVersion
from app.routers.audit import record_audit
from app.schemas import SemanticSearchHit, SemanticSearchRequest
from app.services import file_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/candidates", tags=["candidates"], dependencies=[Depends(require_staff)])


def _parse_tags(raw: Optional[str]) -> List[str]:
    """Deserialize the JSON-encoded tags column; tolerant of null/blank/corrupt values."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return [str(t) for t in parsed] if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


class CandidateSearchItem(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    current_title: Optional[str] = None
    experience_level: Optional[str] = None
    years_experience: Optional[float] = None
    stage: str = "applied"
    source: Optional[str] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    latest_job_role: Optional[str] = None
    latest_evaluation_id: Optional[int] = None
    tags: List[str] = Field(default_factory=list)

    class Config:
        from_attributes = True


class PaginatedCandidates(BaseModel):
    items: List[CandidateSearchItem]
    total: int
    page: int
    limit: int
    pages: int


class BulkDeleteRequest(BaseModel):
    ids: List[int]


class CandidateUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    current_title: Optional[str] = None
    experience_level: Optional[str] = None
    years_experience: Optional[float] = None
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    # Same enum the DB check constraint (candidates_stage_check) and
    # results.py's UpdateCandidateStageRequest enforce — validating here too
    # turns a bad value into a clean 422 instead of an unhandled 500 from the
    # DB CheckViolation at commit time.
    stage: Optional[str] = Field(
        None, pattern="^(applied|screening|coding|interview|offer|hired|rejected)$"
    )
    tags: Optional[List[str]] = None


@router.get("/search", response_model=PaginatedCandidates)
def search_candidates(
    q: Optional[str] = Query(None, description="Search name, email, or title"),
    stage: Optional[str] = Query(None),
    experience_level: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    query = db.query(Candidate).filter(Candidate.deleted_at.is_(None))

    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Candidate.name.ilike(pattern),
                Candidate.email.ilike(pattern),
                Candidate.current_title.ilike(pattern),
            )
        )
    if stage:
        query = query.filter(Candidate.stage == stage)
    if experience_level:
        query = query.filter(Candidate.experience_level == experience_level)

    total = query.count()
    candidates = (
        query.order_by(Candidate.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    # Fetch latest evaluation (id + job role title) per candidate in one query
    candidate_ids = [c.id for c in candidates]
    latest_roles: dict[int, str] = {}
    latest_eval_ids: dict[int, int] = {}
    if candidate_ids:
        rows = (
            db.query(Evaluation.id, ResumeVersion.candidate_id, JobRole.title)
            .join(Resume, Evaluation.resume_id == Resume.id)
            .join(ResumeVersion, ResumeVersion.id == Resume.id)
            .join(JobRole, Evaluation.job_role_id == JobRole.id)
            .filter(ResumeVersion.candidate_id.in_(candidate_ids))
            .order_by(Evaluation.evaluated_at.desc())
            .all()
        )
        for eval_id, cid, title in rows:
            if cid not in latest_roles:
                latest_roles[cid] = title
                latest_eval_ids[cid] = eval_id

    items = [
        CandidateSearchItem(
            id=c.id,
            name=c.name,
            email=c.email,
            phone=getattr(c, "phone", None),
            location=getattr(c, "location", None),
            current_title=getattr(c, "current_title", None),
            experience_level=getattr(c, "experience_level", None),
            years_experience=getattr(c, "years_experience", None),
            stage=c.stage or "applied",
            linkedin_url=c.linkedin_url,
            github_url=c.github_url,
            portfolio_url=c.portfolio_url,
            latest_job_role=latest_roles.get(c.id),
            latest_evaluation_id=latest_eval_ids.get(c.id),
            tags=_parse_tags(getattr(c, "tags", None)),
        )
        for c in candidates
    ]

    return PaginatedCandidates(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=max(1, math.ceil(total / limit)),
    )


@router.post("/semantic-search", response_model=List[SemanticSearchHit])
def semantic_search_candidates(
    body: SemanticSearchRequest,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> List[SemanticSearchHit]:
    """Natural-language talent-pool search via sentence embeddings + cosine similarity.

    Encodes each candidate's current resume text (cached in-memory per resume_id
    so repeat searches don't re-embed the same resume) and ranks by similarity
    to the query vector.
    """
    from app.services.embedder import embedder

    if not embedder.is_loaded():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Semantic search model is not loaded yet. Try again shortly.",
        )

    query_vec = embedder.encode(body.query)

    rows = (
        db.query(Candidate, ResumeVersion, Resume)
        .join(ResumeVersion, ResumeVersion.candidate_id == Candidate.id)
        .join(Resume, Resume.id == ResumeVersion.id)
        .filter(
            Candidate.deleted_at.is_(None),
            ResumeVersion.is_current.is_(True),
            Resume.raw_text.isnot(None),
        )
        .all()
    )

    scored: list[tuple[float, Candidate, str]] = []
    for candidate, resume_version, resume in rows:
        text = (resume.raw_text or "")[:2000]
        if not text.strip():
            continue
        cached = embedder.get_cached_section(resume_version.id, "semantic_search_full")
        if cached is not None:
            vec = cached
        else:
            vec = embedder.encode_batch([text])[0]
            embedder.cache_section(resume_version.id, "semantic_search_full", vec)
        similarity = embedder.cosine_similarity(query_vec, vec)
        scored.append((similarity, candidate, text))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[: body.limit]

    # Latest evaluation id per candidate, so results can link to /results/:id
    top_ids = [c.id for _, c, _ in top]
    latest_eval_ids: dict[int, int] = {}
    if top_ids:
        eval_rows = (
            db.query(Evaluation.id, ResumeVersion.candidate_id)
            .join(Resume, Evaluation.resume_id == Resume.id)
            .join(ResumeVersion, ResumeVersion.id == Resume.id)
            .filter(ResumeVersion.candidate_id.in_(top_ids))
            .order_by(Evaluation.evaluated_at.desc())
            .all()
        )
        for eval_id, cid in eval_rows:
            latest_eval_ids.setdefault(cid, eval_id)

    return [
        SemanticSearchHit(
            candidate_id=c.id,
            name=c.name,
            email=c.email,
            current_title=getattr(c, "current_title", None),
            experience_level=getattr(c, "experience_level", None),
            location=getattr(c, "location", None),
            similarity=round(sim, 4),
            snippet=text[:280].replace("\n", " ").strip(),
            latest_evaluation_id=latest_eval_ids.get(c.id),
        )
        for sim, c, text in top
    ]


@router.patch("/{candidate_id}", response_model=CandidateSearchItem)
def update_candidate(
    candidate_id: int,
    body: CandidateUpdate,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> CandidateSearchItem:
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    changes: dict = {}
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "tags":
            old = _parse_tags(getattr(candidate, "tags", None))
            if old != (value or []):
                changes["tags"] = [old, value or []]
            candidate.tags = json.dumps(value or [])
            continue
        old = getattr(candidate, field, None)
        if old != value:
            changes[field] = [old, value]
        setattr(candidate, field, value)

    if changes:
        record_audit(db, _current_user.id, "update", "candidate", candidate_id, changes)
    db.commit()
    db.refresh(candidate)

    return CandidateSearchItem(
        id=candidate.id,
        name=candidate.name,
        email=candidate.email,
        phone=getattr(candidate, "phone", None),
        location=getattr(candidate, "location", None),
        current_title=getattr(candidate, "current_title", None),
        experience_level=getattr(candidate, "experience_level", None),
        years_experience=getattr(candidate, "years_experience", None),
        stage=candidate.stage or "applied",
        linkedin_url=candidate.linkedin_url,
        github_url=candidate.github_url,
        portfolio_url=candidate.portfolio_url,
        latest_job_role=None,
        latest_evaluation_id=None,
        tags=_parse_tags(getattr(candidate, "tags", None)),
    )


@router.delete("/{candidate_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
def hard_delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(require_permission("can_delete")),
):
    """Permanently delete a candidate and ALL their data (resumes, evaluations, emails).

    This is irreversible. Use soft-delete (DELETE /{id}) when you want to archive instead.
    """
    from app.models import InboundEmail
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    # Delete all resume versions (cascade handles resumes + evaluations via FK)
    versions = db.query(ResumeVersion).filter(ResumeVersion.candidate_id == candidate_id).all()
    for rv in versions:
        file_store.remove(rv.file_path)  # SharePoint item or disk file; never raises
        resume = db.query(Resume).filter(Resume.id == rv.id).first()
        if resume:
            from app.models import Evaluation
            db.query(Evaluation).filter(Evaluation.resume_id == resume.id).delete()
            db.delete(resume)
        db.delete(rv)

    # Delete inbound email records for this candidate's email
    if candidate.email:
        db.query(InboundEmail).filter(
            InboundEmail.sender_email == candidate.email
        ).delete()

    record_audit(db, _current_user.id, "hard_delete", "candidate", candidate_id)
    db.delete(candidate)
    db.commit()


@router.delete("/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(require_permission("can_delete")),
):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    candidate.deleted_at = datetime.now(timezone.utc)
    record_audit(db, _current_user.id, "delete", "candidate", candidate_id)
    db.commit()


@router.post("/bulk-delete", status_code=status.HTTP_200_OK)
def bulk_delete_candidates(
    body: BulkDeleteRequest,
    db: Session = Depends(get_db),
    _current_user=Depends(require_permission("can_delete")),
) -> dict:
    if not body.ids:
        return {"deleted": 0}
    now = datetime.now(timezone.utc)
    updated = (
        db.query(Candidate)
        .filter(Candidate.id.in_(body.ids), Candidate.deleted_at.is_(None))
        .all()
    )
    for c in updated:
        c.deleted_at = now
        record_audit(db, _current_user.id, "delete", "candidate", c.id)
    db.commit()
    return {"deleted": len(updated)}


@router.post("/{candidate_id}/restore", response_model=CandidateSearchItem)
def restore_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> CandidateSearchItem:
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    candidate.deleted_at = None
    record_audit(db, _current_user.id, "restore", "candidate", candidate_id)
    db.commit()
    db.refresh(candidate)
    return CandidateSearchItem(
        id=candidate.id,
        name=candidate.name,
        email=candidate.email,
        phone=getattr(candidate, "phone", None),
        location=getattr(candidate, "location", None),
        current_title=getattr(candidate, "current_title", None),
        experience_level=getattr(candidate, "experience_level", None),
        years_experience=getattr(candidate, "years_experience", None),
        stage=candidate.stage or "applied",
        source=getattr(candidate, "source", None),
        linkedin_url=candidate.linkedin_url,
        github_url=candidate.github_url,
        portfolio_url=candidate.portfolio_url,
        latest_job_role=None,
        latest_evaluation_id=None,
        tags=_parse_tags(getattr(candidate, "tags", None)),
    )


def _name_from_stored_pdf(rv: ResumeVersion, extract) -> Optional[str]:
    """Font-size name extraction on the stored file (a SharePoint ref is downloaded to a temp
    copy); None when the file cannot be read, so the text-based fallbacks take over."""
    if not rv.file_path:
        return None
    suffix = os.path.splitext(rv.filename or "")[1].lower() if file_store.is_ref(rv.file_path) else ""
    if file_store.is_ref(rv.file_path) and suffix != ".pdf":
        return None  # only PDFs carry the font signal; skip the download
    try:
        with file_store.local_copy(rv.file_path, suffix=suffix) as local_path:
            return extract(local_path or "")
    except Exception as exc:  # SharePoint unreachable etc.: fall back to text heuristics
        logger.warning("Could not read stored resume %s for name extraction: %s", rv.id, exc)
        return None


@router.post("/reparse-all")
def reparse_all_candidates(
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> dict:
    """Re-extract name, graduation year and location for every active candidate that has a current resume."""
    from sqlalchemy.orm import joinedload

    from app.services.parser import (
        extract_name, extract_name_from_pdf_fonts,
        extract_graduation_year, extract_metadata_via_llm, is_plausible_name,
        extract_location,
    )
    from app.services.segmenter import segment_text

    candidates = db.query(Candidate).filter(Candidate.deleted_at.is_(None)).all()
    current_versions = (
        db.query(ResumeVersion)
        .options(joinedload(ResumeVersion.resume))
        .filter(ResumeVersion.is_current.is_(True))
        .all()
    )
    versions_by_candidate = {rv.candidate_id: rv for rv in current_versions}

    updated = 0
    for candidate in candidates:
        rv = versions_by_candidate.get(candidate.id)
        if not rv or not rv.resume or not rv.resume.raw_text:
            continue
        raw_text = rv.resume.raw_text
        is_updated = False
        # 1st: font-size (largest text in top 30% of page 1 — immune to column ordering)
        # 2nd: regex on extracted text (geographic/non-name blacklist)
        # 3rd: LLM validated against the same blacklist
        new_name = _name_from_stored_pdf(rv, extract_name_from_pdf_fonts)
        if not new_name:
            new_name = extract_name(raw_text)
        if not new_name:
            llm_meta = extract_metadata_via_llm(raw_text) or {}
            llm_name = (llm_meta.get("name") or "").strip()
            if llm_name and is_plausible_name(llm_name):
                new_name = llm_name
        if new_name and new_name != candidate.name:
            candidate.name = new_name
            is_updated = True
        sections = segment_text(raw_text)
        new_year = extract_graduation_year(sections, raw_text=raw_text)
        if new_year and new_year != candidate.graduation_year:
            candidate.graduation_year = new_year
            is_updated = True
        new_loc = extract_location(raw_text)
        if new_loc and new_loc != getattr(candidate, "location", None):
            candidate.location = new_loc
            is_updated = True
        if is_updated:
            updated += 1
    db.commit()
    return {"updated": updated, "total": len(candidates)}


@router.post("/{candidate_id}/reparse", response_model=CandidateSearchItem)
def reparse_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(get_current_user),
) -> CandidateSearchItem:
    """Re-extract name, graduation year and location from the stored resume text using the current parser."""
    from app.services.parser import (
        extract_name, extract_name_from_pdf_fonts,
        extract_graduation_year, extract_metadata_via_llm, is_plausible_name,
        extract_location,
    )
    from app.models import Resume, ResumeVersion
    from app.services.segmenter import segment_text

    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    rv = (
        db.query(ResumeVersion)
        .filter(ResumeVersion.candidate_id == candidate_id, ResumeVersion.is_current.is_(True))
        .first()
    )
    if not rv or not rv.resume or not rv.resume.raw_text:
        raise HTTPException(status_code=404, detail="No current resume text found for this candidate")

    raw_text = rv.resume.raw_text
    changes: dict = {}

    # 1st: font-size (largest text in top 30% of page 1)
    # 2nd: regex on extracted text (geographic/non-name blacklist)
    # 3rd: LLM validated against the same blacklist
    new_name = _name_from_stored_pdf(rv, extract_name_from_pdf_fonts)
    if not new_name:
        new_name = extract_name(raw_text)
    if not new_name:
        llm_meta = extract_metadata_via_llm(raw_text) or {}
        llm_name = (llm_meta.get("name") or "").strip()
        if llm_name and is_plausible_name(llm_name):
            new_name = llm_name
    if new_name and new_name != candidate.name:
        changes["name"] = [candidate.name, new_name]
        candidate.name = new_name

    sections = segment_text(raw_text)
    new_year = extract_graduation_year(sections, raw_text=raw_text)
    if new_year and new_year != candidate.graduation_year:
        changes["graduation_year"] = [candidate.graduation_year, new_year]
        candidate.graduation_year = new_year

    new_loc = extract_location(raw_text)
    if new_loc and new_loc != getattr(candidate, "location", None):
        changes["location"] = [getattr(candidate, "location", None), new_loc]
        candidate.location = new_loc

    if changes:
        record_audit(db, _current_user.id, "reparse", "candidate", candidate_id, changes)

    db.commit()
    db.refresh(candidate)
    return CandidateSearchItem(
        id=candidate.id,
        name=candidate.name,
        email=candidate.email,
        phone=getattr(candidate, "phone", None),
        location=getattr(candidate, "location", None),
        current_title=getattr(candidate, "current_title", None),
        experience_level=getattr(candidate, "experience_level", None),
        years_experience=getattr(candidate, "years_experience", None),
        stage=candidate.stage or "applied",
        source=getattr(candidate, "source", None),
        linkedin_url=candidate.linkedin_url,
        github_url=candidate.github_url,
        portfolio_url=candidate.portfolio_url,
        latest_job_role=None,
        latest_evaluation_id=None,
        tags=_parse_tags(getattr(candidate, "tags", None)),
    )
