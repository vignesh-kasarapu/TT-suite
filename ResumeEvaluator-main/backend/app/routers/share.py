"""Token-gated read-only share links for hiring managers / external clients."""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session, joinedload

from app.deps import get_db, require_staff
from app.models import (
    Candidate,
    Evaluation,
    JobRole,
    Resume,
    ResumeVersion,
    ShareLink,
    Shortlist,
)

router = APIRouter(prefix="/share", tags=["share"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class CreateShareLinkRequest(BaseModel):
    job_role_id: int
    evaluation_ids: Optional[List[int]] = None   # null = all for the role
    stages: Optional[List[str]] = None           # null = all stages
    label: Optional[str] = None
    recipient_name: Optional[str] = None
    expires_in_days: Optional[int] = 30          # null = never


class ShareLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    token: str
    job_role_id: Optional[int]
    label: Optional[str]
    recipient_name: Optional[str]
    created_at: datetime
    expires_at: Optional[datetime]
    is_active: bool
    candidate_count: int
    stages: Optional[List[str]] = None


class ShareCandidateOut(BaseModel):
    evaluation_id: int
    candidate_id: int
    candidate_name: str
    current_title: Optional[str]
    experience_level: Optional[str]
    years_experience: Optional[float]
    location: Optional[str]
    total_score: float
    project_score: float
    skill_score: float
    education_score: float
    skills_matched: int
    skills_total: int
    matched_skill_names: List[str]
    status: Optional[str]
    reasoning_summary: Optional[str]
    upvotes: int
    downvotes: int
    my_vote: Optional[str]        # "up" | "down" | None (based on voter_token cookie)


class ShareViewOut(BaseModel):
    token: str
    label: Optional[str]
    recipient_name: Optional[str]
    job_role_title: str
    created_at: datetime
    expires_at: Optional[datetime]
    candidates: List[ShareCandidateOut]


class VoteRequest(BaseModel):
    evaluation_id: int
    vote: str                   # "up" | "down" | "clear"
    voter_token: str            # generated client-side UUID, persisted in localStorage
    comment: Optional[str] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_json(raw: Optional[str]) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_share_link(token: str, db: Session) -> ShareLink:
    link = db.query(ShareLink).filter(ShareLink.token == token).first()
    if not link or not link.is_active:
        raise HTTPException(status_code=404, detail="Share link not found or deactivated.")
    
    if link.expires_at:
        # Compare as timezone-naive to match the naive DateTime format stored in DB
        expires_at_naive = link.expires_at.replace(tzinfo=None)
        utcnow_naive = _utcnow().replace(tzinfo=None)
        if expires_at_naive < utcnow_naive:
            raise HTTPException(status_code=410, detail="This share link has expired.")
    return link


def _candidate_count(link: ShareLink, db: Session) -> int:
    if link.evaluation_ids:
        ids = _parse_json(link.evaluation_ids)
        return len(ids) if isinstance(ids, list) else 0
    stages_filter = _parse_json(link.stages) if link.stages else None
    if stages_filter:
        return (
            db.query(Evaluation.id)
            .join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
            .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
            .filter(
                Evaluation.job_role_id == link.job_role_id,
                Evaluation.stage.in_(stages_filter),
                ResumeVersion.is_current.is_(True),
                Candidate.deleted_at.is_(None),
            )
            .count()
        )
    return 0


# ─── Recruiter endpoints (auth required) ─────────────────────────────────────

@router.post("", response_model=ShareLinkOut, status_code=status.HTTP_201_CREATED)
def create_share_link(
    payload: CreateShareLinkRequest,
    db: Session = Depends(get_db),
    _current_user = Depends(require_staff),
) -> ShareLinkOut:
    role = db.query(JobRole).filter(JobRole.id == payload.job_role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Job role not found.")

    expires_at = None
    if payload.expires_in_days is not None:
        expires_at = _utcnow() + timedelta(days=payload.expires_in_days)

    eval_ids_json: Optional[str] = None
    stages_json: Optional[str] = None

    if payload.stages is not None and len(payload.stages) > 0:
        stages_json = json.dumps(payload.stages)
        eval_ids_json = None
    else:
        if payload.evaluation_ids is not None:
            eval_ids_json = json.dumps(payload.evaluation_ids)
        else:
            # Auto-collect all evaluated for the role
            evals = (
                db.query(Evaluation.id)
                .join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
                .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
                .filter(
                    Evaluation.job_role_id == payload.job_role_id,
                    ResumeVersion.is_current.is_(True),
                    Candidate.deleted_at.is_(None),
                )
                .all()
            )
            eval_ids_json = json.dumps([e.id for e in evals])

    link = ShareLink(
        token=secrets.token_urlsafe(32),
        job_role_id=payload.job_role_id,
        evaluation_ids=eval_ids_json,
        stages=stages_json,
        label=payload.label,
        recipient_name=payload.recipient_name,
        created_by=_current_user.id,
        expires_at=expires_at,
        is_active=True,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    stages_out = _parse_json(link.stages) if link.stages else None
    return ShareLinkOut(
        id=link.id,
        token=link.token,
        job_role_id=link.job_role_id,
        label=link.label,
        recipient_name=link.recipient_name,
        created_at=link.created_at,
        expires_at=link.expires_at,
        is_active=link.is_active,
        candidate_count=_candidate_count(link, db),
        stages=stages_out,
    )


@router.get("", response_model=List[ShareLinkOut])
def list_share_links(
    job_role_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _current_user = Depends(require_staff),
) -> List[ShareLinkOut]:
    q = db.query(ShareLink)
    if job_role_id is not None:
        q = q.filter(ShareLink.job_role_id == job_role_id)
    links = q.order_by(ShareLink.created_at.desc()).all()
    result = []
    for link in links:
        stages_out = _parse_json(link.stages) if link.stages else None
        result.append(ShareLinkOut(
            id=link.id,
            token=link.token,
            job_role_id=link.job_role_id,
            label=link.label,
            recipient_name=link.recipient_name,
            created_at=link.created_at,
            expires_at=link.expires_at,
            is_active=link.is_active,
            candidate_count=_candidate_count(link, db),
            stages=stages_out,
        ))
    return result


@router.delete("/{link_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def deactivate_share_link(
    link_id: int,
    db: Session = Depends(get_db),
    _current_user = Depends(require_staff),
) -> None:
    link = db.query(ShareLink).filter(ShareLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found.")
    link.is_active = False
    db.commit()


# ─── Public endpoints (no auth) ──────────────────────────────────────────────

@router.get("/view/{token}", response_model=ShareViewOut)
def get_share_view(
    token: str,
    voter_token: Optional[str] = None,
    db: Session = Depends(get_db),
) -> ShareViewOut:
    link = _get_share_link(token, db)
    
    stages_filter: Optional[List[str]] = _parse_json(link.stages) if link.stages else None
    eval_ids: Optional[List[int]] = _parse_json(link.evaluation_ids) if link.evaluation_ids else None

    query = (
        db.query(Evaluation)
        .options(
            joinedload(Evaluation.resume).joinedload(Resume.version).joinedload(ResumeVersion.candidate),
            joinedload(Evaluation.shortlists),
            joinedload(Evaluation.job_role),
        )
        .filter(Evaluation.job_role_id == link.job_role_id)
    )

    if eval_ids is not None:
        query = query.filter(Evaluation.id.in_(eval_ids))
    elif stages_filter is not None:
        query = (
            query.join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
            .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
            .filter(Evaluation.stage.in_(stages_filter))
            .filter(Candidate.deleted_at.is_(None))
            .filter(ResumeVersion.is_current.is_(True))
        )
    else:
        # Fallback to query all active candidates
        query = (
            query.join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
            .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
            .filter(Candidate.deleted_at.is_(None))
            .filter(ResumeVersion.is_current.is_(True))
        )

    evals = query.order_by(Evaluation.total_score.desc()).all()

    # Parse votes
    votes_data: List[Dict] = _parse_json(link.votes) or []
    votes_map: Dict[int, Dict[str, int]] = {}  # eval_id -> {up: N, down: N}
    my_votes: Dict[int, str] = {}
    for v in votes_data:
        eid = v.get("evaluation_id")
        if eid is None:
            continue
        if eid not in votes_map:
            votes_map[eid] = {"up": 0, "down": 0}
        vote_val = v.get("vote")
        if vote_val == "up":
            votes_map[eid]["up"] += 1
        elif vote_val == "down":
            votes_map[eid]["down"] += 1
        if voter_token and v.get("voter_token") == voter_token:
            my_votes[eid] = vote_val

    # Skills total map
    from sqlalchemy import func as sa_func
    from app.models import JobRoleSkill
    role_ids = {ev.job_role_id for ev in evals}
    skills_total_map: Dict[int, int] = {}
    if role_ids:
        rows = (
            db.query(JobRoleSkill.job_role_id, sa_func.count(JobRoleSkill.id))
            .filter(JobRoleSkill.job_role_id.in_(role_ids))
            .group_by(JobRoleSkill.job_role_id)
            .all()
        )
        skills_total_map = {r[0]: r[1] for r in rows}

    candidates_out: List[ShareCandidateOut] = []
    for ev in evals:
        rv = ev.resume.version if ev.resume else None
        cand = rv.candidate if rv else None
        sm_list = _parse_json(ev.skills_matched) or []
        matched_names = [m["skill_name"] for m in sm_list if isinstance(m, dict)]
        latest_status = ev.stage or (cand.stage if cand else None)
        if (not latest_status or latest_status == "applied") and ev.shortlists:
            latest_status = max(ev.shortlists, key=lambda s: s.changed_at).status

        vmap = votes_map.get(ev.id, {"up": 0, "down": 0})
        candidates_out.append(ShareCandidateOut(
            evaluation_id=ev.id,
            candidate_id=cand.id if cand else 0,
            candidate_name=cand.name if cand else "Unknown",
            current_title=getattr(cand, "current_title", None),
            experience_level=getattr(cand, "experience_level", None),
            years_experience=getattr(cand, "years_experience", None),
            location=getattr(cand, "location", None),
            total_score=ev.total_score,
            project_score=ev.project_score,
            skill_score=ev.skill_score,
            education_score=ev.education_score,
            skills_matched=len(sm_list),
            skills_total=skills_total_map.get(ev.job_role_id, 0),
            matched_skill_names=matched_names[:8],
            status=latest_status,
            reasoning_summary=ev.reasoning_summary,
            upvotes=vmap["up"],
            downvotes=vmap["down"],
            my_vote=my_votes.get(ev.id),
        ))

    role_title = link.job_role.title if link.job_role else "Unknown Role"

    return ShareViewOut(
        token=token,
        label=link.label,
        recipient_name=link.recipient_name,
        job_role_title=role_title,
        created_at=link.created_at,
        expires_at=link.expires_at,
        candidates=candidates_out,
    )


@router.post("/view/{token}/vote", status_code=status.HTTP_200_OK)
def submit_vote(
    token: str,
    payload: VoteRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    link = _get_share_link(token, db)
    
    is_valid = False
    if link.evaluation_ids:
        eval_ids = _parse_json(link.evaluation_ids) or []
        is_valid = payload.evaluation_id in eval_ids
    else:
        stages_filter = _parse_json(link.stages) if link.stages else None
        query = db.query(Evaluation).filter(
            Evaluation.id == payload.evaluation_id,
            Evaluation.job_role_id == link.job_role_id
        )
        if stages_filter:
            query = (
                query.join(ResumeVersion, Evaluation.resume_id == ResumeVersion.id)
                .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
                .filter(Evaluation.stage.in_(stages_filter))
                .filter(Candidate.deleted_at.is_(None))
                .filter(ResumeVersion.is_current.is_(True))
            )
        is_valid = query.first() is not None

    if not is_valid:
        raise HTTPException(status_code=400, detail="Evaluation not in this share link.")

    votes_data: List[Dict] = _parse_json(link.votes) or []
    # Remove existing vote from this voter_token for this eval
    votes_data = [
        v for v in votes_data
        if not (v.get("voter_token") == payload.voter_token and v.get("evaluation_id") == payload.evaluation_id)
    ]
    if payload.vote != "clear":
        votes_data.append({
            "evaluation_id": payload.evaluation_id,
            "voter_token": payload.voter_token,
            "vote": payload.vote,
            "comment": payload.comment,
        })

    link.votes = json.dumps(votes_data)
    db.commit()
    return {"status": "ok"}
