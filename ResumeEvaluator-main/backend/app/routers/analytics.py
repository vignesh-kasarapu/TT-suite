"""Analytics endpoints.

GET /analytics  — aggregated stats for a job role
"""
from __future__ import annotations

import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_staff
from app.models import (
    Candidate,
    Evaluation,
    JobRoleSkill,
    Outcome,
    Resume,
    ResumeVersion,
    Skill,
    User,
)
from app.schemas import SkillMatchDetail
from app.services.analytics_queries import active_evaluations_query, latest_shortlist_status

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analytics", tags=["analytics"], dependencies=[Depends(require_staff)])


# ---------------------------------------------------------------------------
# Response model (inline — no separate schema file needed)
# ---------------------------------------------------------------------------

from pydantic import BaseModel


class SkillMatchRate(BaseModel):
    skill_name: str
    matched_count: int
    total: int
    match_rate: float   # 0–100


class ScoreBucket(BaseModel):
    range: str
    count: int


class DailyCount(BaseModel):
    date: str   # "YYYY-MM-DD"
    count: int


class SectionAverages(BaseModel):
    projects: float
    skills: float
    education: float


class StageFunnelItem(BaseModel):
    stage: str
    label: str
    count: int


_STAGE_ORDER = ["applied", "screening", "coding", "interview", "offer", "hired", "rejected"]
_STAGE_LABELS = {
    "applied": "Applied", "screening": "Screening", "coding": "Coding Test",
    "interview": "Interview", "offer": "Offer", "hired": "Hired", "rejected": "Rejected",
}


class AnalyticsOut(BaseModel):
    total_evaluated: int
    avg_score: float
    score_distribution: List[ScoreBucket]
    status_counts: Dict[str, int]
    skill_match_rates: List[SkillMatchRate]
    top_skill_gaps: List[str]
    section_averages: SectionAverages
    evaluations_per_day: List[DailyCount]
    needs_review_count: int
    pending_count: int = 0
    stage_funnel: List[StageFunnelItem] = []
    experience_level_counts: Dict[str, int] = {}
    avg_score_by_level: Dict[str, float] = {}


class CalibrationBucket(BaseModel):
    range: str
    score_min: int
    score_max: int
    total: int
    hired: int
    rejected: int
    hire_rate: float   # 0–100


class ThresholdOption(BaseModel):
    threshold: float
    precision: float   # % of above-threshold candidates that were hired
    recall: float      # % of hired candidates that are above threshold
    f1: float
    candidates_above: int


class CalibrationOut(BaseModel):
    buckets: List[CalibrationBucket]
    total_with_outcomes: int
    total_hired: int
    total_rejected: int
    suggested_threshold: Optional[float]
    threshold_options: List[ThresholdOption]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("", response_model=AnalyticsOut)
def get_analytics(
    job_role_id: Optional[int] = Query(default=None),
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsOut:
    """Return aggregated analytics for all (or a specific) job role."""

    # ── Load all evaluations (mirrors leaderboard base query exactly) ────
    evals = [ev for ev, _ in active_evaluations_query(db, job_role_id).all()]

    # Split: LLM-scored evals for score/skill/review metrics; all evals for totals
    scored_evals = [ev for ev in evals if ev.eval_status is None]
    total = len(evals)

    if total == 0:
        empty_dist = [ScoreBucket(range=f"{i*10}-{i*10+10}", count=0) for i in range(10)]
        return AnalyticsOut(
            total_evaluated=0,
            avg_score=0.0,
            score_distribution=empty_dist,
            status_counts={},
            skill_match_rates=[],
            top_skill_gaps=[],
            section_averages=SectionAverages(projects=0.0, skills=0.0, education=0.0),
            evaluations_per_day=[],
            needs_review_count=0,
            pending_count=0,
        )

    # ── Score distribution (LLM-scored only — auto-rejected have no LLM score) ──
    buckets = [0] * 10
    score_sum = 0.0
    proj_sum = skills_sum = edu_sum = 0.0
    needs_review_count = 0

    # Batch-fetch needs_manual_review per evaluation's resume in one query
    # instead of lazy-loading ev.resume -> .version -> .candidate per row.
    resume_ids = [ev.resume_id for ev in scored_evals]
    review_flags: Dict[int, bool] = {}
    if resume_ids:
        review_rows = (
            db.query(ResumeVersion.id, Candidate.needs_manual_review)
            .join(Candidate, ResumeVersion.candidate_id == Candidate.id)
            .filter(ResumeVersion.id.in_(resume_ids))
            .all()
        )
        review_flags = {rv_id: bool(flag) for rv_id, flag in review_rows}

    for ev in scored_evals:
        score_sum += ev.total_score
        proj_sum += ev.project_score
        skills_sum += ev.skill_score
        edu_sum += ev.education_score
        idx = min(int(ev.total_score // 10), 9)
        buckets[idx] += 1
        if review_flags.get(ev.resume_id):
            needs_review_count += 1

    score_dist = [
        ScoreBucket(range=f"{i*10}-{i*10+10}", count=buckets[i])
        for i in range(10)
    ]

    # ── Status counts ─────────────────────────────────────────────────────
    # Build latest shortlist status map for LLM-scored evals
    scored_ids = [ev.id for ev in scored_evals]
    latest_status: Dict[int, str] = latest_shortlist_status(db, scored_ids)

    status_counter: Counter = Counter()
    for ev in evals:
        if ev.eval_status in ("tfidf_filtered", "experience_filtered"):
            status_counter["rejected"] += 1
        else:
            st = latest_status.get(ev.id, "none")
            status_counter[st] += 1
    status_counts = dict(status_counter)

    # pending = scored evals with no shortlist record and not flagged for review
    # mirrors leaderboard "Next Consideration" = needs_review_count + pending_count
    pending_count = 0
    for ev in scored_evals:
        if ev.id not in latest_status:
            try:
                is_flagged = (
                    ev.resume and ev.resume.version
                    and ev.resume.version.candidate
                    and ev.resume.version.candidate.needs_manual_review
                )
            except AttributeError:
                is_flagged = False
            if not is_flagged:
                pending_count += 1

    # ── Per-skill match rates (LLM-scored only) ──────────────────────────
    skill_hit: Counter = Counter()
    skill_total: Counter = Counter()
    scored_total = len(scored_evals)

    if job_role_id is not None:
        jrs_rows = db.query(JobRoleSkill).filter(JobRoleSkill.job_role_id == job_role_id).all()
        skill_ids = [j.skill_id for j in jrs_rows]
        required_skills = [s.name for s in db.query(Skill).filter(Skill.id.in_(skill_ids)).all()]
        for sname in required_skills:
            skill_total[sname] += scored_total
    else:
        required_skills = []

    for ev in scored_evals:
        if not ev.skills_matched:
            continue
        try:
            matched = json.loads(ev.skills_matched)
            for sm in matched:
                skill_hit[sm.get("skill_name", "")] += 1
        except (json.JSONDecodeError, ValueError):
            pass

    if required_skills:
        skill_match_rates = [
            SkillMatchRate(
                skill_name=sname,
                matched_count=skill_hit[sname],
                total=skill_total[sname],
                match_rate=round(skill_hit[sname] / skill_total[sname] * 100, 1)
                if skill_total[sname] else 0.0,
            )
            for sname in required_skills
        ]
        skill_match_rates.sort(key=lambda x: x.match_rate)
    else:
        skill_match_rates = [
            SkillMatchRate(
                skill_name=sname,
                matched_count=cnt,
                total=scored_total,
                match_rate=round(cnt / scored_total * 100, 1) if scored_total else 0.0,
            )
            for sname, cnt in skill_hit.most_common(20)
        ]

    top_skill_gaps = [r.skill_name for r in skill_match_rates if r.match_rate < 50][:10]

    # ── Evaluations per day (last N days, all evals including auto-rejected) ──
    cutoff = datetime.utcnow() - timedelta(days=days)
    day_counter: Counter = Counter()
    for ev in evals:
        if ev.evaluated_at and ev.evaluated_at >= cutoff:
            day_counter[ev.evaluated_at.strftime("%Y-%m-%d")] += 1

    # Fill in missing days with 0
    daily: List[DailyCount] = []
    for i in range(days):
        d = (datetime.utcnow() - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d")
        daily.append(DailyCount(date=d, count=day_counter.get(d, 0)))

    # ── Stage funnel (LLM-scored only — auto-rejected aren't in pipeline stages) ─
    stage_counts: Counter = Counter()
    exp_level_counts: Counter = Counter()
    exp_level_scores: dict[str, list[float]] = defaultdict(list)
    for ev in scored_evals:
        try:
            cand = ev.resume.version.candidate if ev.resume and ev.resume.version else None
            if cand:
                stage_counts[ev.stage or cand.stage] += 1
                lvl = getattr(cand, "experience_level", None) or "unknown"
                exp_level_counts[lvl] += 1
                exp_level_scores[lvl].append(ev.total_score)
        except AttributeError:
            pass
    stage_funnel = [
        StageFunnelItem(stage=s, label=_STAGE_LABELS.get(s, s), count=stage_counts.get(s, 0))
        for s in _STAGE_ORDER
    ]
    avg_score_by_level = {
        lvl: round(sum(scores) / len(scores), 1)
        for lvl, scores in exp_level_scores.items()
        if scores
    }

    return AnalyticsOut(
        total_evaluated=total,
        avg_score=round(score_sum / scored_total, 1) if scored_total else 0.0,
        score_distribution=score_dist,
        status_counts=status_counts,
        skill_match_rates=skill_match_rates,
        top_skill_gaps=top_skill_gaps,
        section_averages=SectionAverages(
            projects=round(proj_sum / scored_total, 1) if scored_total else 0.0,
            skills=round(skills_sum / scored_total, 1) if scored_total else 0.0,
            education=round(edu_sum / scored_total, 1) if scored_total else 0.0,
        ),
        evaluations_per_day=daily,
        needs_review_count=needs_review_count,
        pending_count=pending_count,
        stage_funnel=stage_funnel,
        experience_level_counts=dict(exp_level_counts),
        avg_score_by_level=avg_score_by_level,
    )


@router.get("/calibration", response_model=CalibrationOut)
def get_calibration(
    job_role_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CalibrationOut:
    """Score calibration: hire rates per 10-point score bucket and suggested threshold.

    Joins scored Evaluations to Outcome records via the candidate chain
    (evaluation → resume → resume_version → candidate → outcome).
    Returns per-bucket hire rates and a suggested shortlist threshold.
    """
    _empty_buckets = [
        CalibrationBucket(
            range=f"{i*10}-{(i+1)*10}", score_min=i*10, score_max=(i+1)*10,
            total=0, hired=0, rejected=0, hire_rate=0.0,
        )
        for i in range(10)
    ]

    q = (
        db.query(Evaluation.total_score, Outcome.outcome)
        .join(Resume, Resume.id == Evaluation.resume_id)
        .join(ResumeVersion, ResumeVersion.id == Resume.id)
        .join(Candidate, Candidate.id == ResumeVersion.candidate_id)
        .join(Outcome, Outcome.candidate_id == Candidate.id)
        .filter(
            ResumeVersion.is_current.is_(True),
            Evaluation.eval_status.is_(None)
        )
    )
    if job_role_id is not None:
        q = q.filter(Evaluation.job_role_id == job_role_id)

    rows = q.all()  # List[Row(total_score, outcome)]

    if not rows:
        return CalibrationOut(
            buckets=_empty_buckets,
            total_with_outcomes=0,
            total_hired=0,
            total_rejected=0,
            suggested_threshold=None,
            threshold_options=[],
        )

    bucket_hired = [0] * 10
    bucket_rejected = [0] * 10
    bucket_total = [0] * 10

    for score, outcome in rows:
        idx = min(int(score // 10), 9)
        bucket_total[idx] += 1
        if outcome == "hired":
            bucket_hired[idx] += 1
        elif outcome in ("rejected", "withdrew", "ghosted", "declined"):
            bucket_rejected[idx] += 1

    buckets = [
        CalibrationBucket(
            range=f"{i*10}-{(i+1)*10}",
            score_min=i * 10,
            score_max=(i + 1) * 10,
            total=bucket_total[i],
            hired=bucket_hired[i],
            rejected=bucket_rejected[i],
            hire_rate=round(bucket_hired[i] / bucket_total[i] * 100, 1) if bucket_total[i] > 0 else 0.0,
        )
        for i in range(10)
    ]

    total_hired = sum(bucket_hired)
    total_rejected = sum(bucket_rejected)
    total_with_outcomes = len(rows)

    # Compute precision/recall/F1 for each candidate threshold (10, 20, …, 90)
    threshold_options: List[ThresholdOption] = []
    for t in range(1, 10):
        above_total = sum(bucket_total[j] for j in range(t, 10))
        above_hired = sum(bucket_hired[j] for j in range(t, 10))
        if above_total == 0:
            continue
        precision = above_hired / above_total
        recall = above_hired / total_hired if total_hired > 0 else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        threshold_options.append(ThresholdOption(
            threshold=float(t * 10),
            precision=round(precision * 100, 1),
            recall=round(recall * 100, 1),
            f1=round(f1 * 100, 1),
            candidates_above=above_total,
        ))

    # Suggested threshold: highest F1 with at least 2 candidates above
    suggested_threshold: Optional[float] = None
    if threshold_options:
        best = max(
            (opt for opt in threshold_options if opt.candidates_above >= 2),
            key=lambda o: o.f1,
            default=None,
        )
        if best:
            suggested_threshold = best.threshold

    return CalibrationOut(
        buckets=buckets,
        total_with_outcomes=total_with_outcomes,
        total_hired=total_hired,
        total_rejected=total_rejected,
        suggested_threshold=suggested_threshold,
        threshold_options=threshold_options,
    )


# ---------------------------------------------------------------------------
# Diversity & Bias Analytics
# ---------------------------------------------------------------------------

class ExpLevelScoreRow(BaseModel):
    level: str
    count: int
    avg_score: float
    shortlisted: int
    rejected: int
    hired: int
    shortlist_rate: float   # 0-100


class BlindComparisonRow(BaseModel):
    label: str          # "Above 75", "50-75", "Below 50"
    blinded_count: int  # candidate count when blind mode would hide names (proxy: unknown-named)
    all_count: int


class DisparateImpactRow(BaseModel):
    group: str
    count: int
    shortlisted: int
    shortlist_rate: float            # 0-100
    impact_ratio: Optional[float]    # group_rate / reference_rate; None for the "not specified" bucket
    adverse_impact: bool             # True when impact_ratio < 0.8 (4/5ths rule)


class DisparateImpactOut(BaseModel):
    field: str                       # "gender_identity" | "ethnicity"
    rows: List[DisparateImpactRow]
    reference_group: Optional[str]   # group with the highest shortlist rate (the 4/5ths baseline)
    reference_rate: float
    worst_ratio: Optional[float]
    any_adverse_impact: bool


class DiversityOut(BaseModel):
    total_candidates: int
    by_experience_level: List[ExpLevelScoreRow]
    score_buckets_by_level: Dict[str, List[int]]   # level -> list of scores (0-100 rounded)
    stage_progression: List[StageFunnelItem]
    location_counts: Dict[str, int]
    gender_fairness: DisparateImpactOut
    ethnicity_fairness: DisparateImpactOut


def _disparate_impact(rows: list, eval_latest_status: Dict[int, str], field: str) -> DisparateImpactOut:
    """4/5ths-rule disparate impact ratio for one EEO field, grouped by shortlist rate.

    The "not specified" bucket (null/blank self-ID) is reported for transparency
    but excluded from the reference-group/adverse-impact calculation — comparing
    against "declined to answer" isn't a meaningful EEO comparison.
    """
    NOT_SPECIFIED = "Not specified"
    group_data: Dict[str, List[dict]] = defaultdict(list)
    for ev, cand in rows:
        raw = (getattr(cand, field, None) or "").strip()
        group = raw if raw else NOT_SPECIFIED
        group_data[group].append({
            "status": eval_latest_status.get(ev.id),
            "stage": getattr(cand, "stage", "applied"),
        })

    group_rates: Dict[str, float] = {}
    row_rows: List[DisparateImpactRow] = []
    for group, entries in sorted(group_data.items()):
        count = len(entries)
        shortlisted = sum(1 for e in entries if e["status"] == "shortlisted")
        rate = round(shortlisted / count * 100, 1) if count else 0.0
        group_rates[group] = rate
        row_rows.append(DisparateImpactRow(
            group=group, count=count, shortlisted=shortlisted,
            shortlist_rate=rate, impact_ratio=None, adverse_impact=False,
        ))

    comparable = {g: r for g, r in group_rates.items() if g != NOT_SPECIFIED}
    reference_group: Optional[str] = max(comparable, key=lambda g: comparable[g]) if comparable else None
    reference_rate = comparable[reference_group] if reference_group else 0.0

    worst_ratio: Optional[float] = None
    any_adverse = False
    for row in row_rows:
        if row.group == NOT_SPECIFIED or reference_rate <= 0:
            continue
        ratio = round(group_rates[row.group] / reference_rate, 3)
        row.impact_ratio = ratio
        row.adverse_impact = ratio < 0.8
        if row.adverse_impact:
            any_adverse = True
        if worst_ratio is None or ratio < worst_ratio:
            worst_ratio = ratio

    return DisparateImpactOut(
        field=field,
        rows=row_rows,
        reference_group=reference_group,
        reference_rate=reference_rate,
        worst_ratio=worst_ratio,
        any_adverse_impact=any_adverse,
    )


@router.get("/diversity", response_model=DiversityOut)
def get_diversity_analytics(
    job_role_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DiversityOut:
    """Diversity & bias audit: score distribution segmented by experience level."""

    rows = active_evaluations_query(db, job_role_id).all()
    total = len(rows)

    # Batch-fetch latest shortlist status per evaluation in one query — the
    # previous version outerjoin'd Shortlist directly into the main query,
    # which duplicated (Evaluation, Candidate) rows once per shortlist history
    # entry (shortlist history is intentionally append-only, see Shortlist
    # model), inflating every count/average below for any candidate with more
    # than one shortlist action recorded.
    eval_ids = [ev.id for ev, _ in rows]
    eval_latest_status: Dict[int, str] = latest_shortlist_status(db, eval_ids)

    # Group by experience level
    level_data: Dict[str, List[dict]] = defaultdict(list)
    location_counter: Counter = Counter()

    for ev, cand in rows:
        level = getattr(cand, "experience_level", None) or "unknown"
        sl_status = eval_latest_status.get(ev.id)
        stage = getattr(cand, "stage", "applied")
        level_data[level].append({
            "score": ev.total_score,
            "status": sl_status,
            "stage": stage,
        })
        loc = (getattr(cand, "location", None) or "").strip()
        if loc:
            location_counter[loc] += 1

    # Build per-level summary
    by_level: List[ExpLevelScoreRow] = []
    score_buckets: Dict[str, List[int]] = {}
    for level, entries in sorted(level_data.items()):
        count = len(entries)
        avg_score = round(sum(e["score"] for e in entries) / count, 1) if count else 0.0
        shortlisted = sum(1 for e in entries if e["status"] == "shortlisted")
        rejected = sum(1 for e in entries if e["status"] == "rejected" or e["stage"] == "rejected")
        hired = sum(1 for e in entries if e["stage"] == "hired")
        shortlist_rate = round(shortlisted / count * 100, 1) if count else 0.0
        by_level.append(ExpLevelScoreRow(
            level=level,
            count=count,
            avg_score=avg_score,
            shortlisted=shortlisted,
            rejected=rejected,
            hired=hired,
            shortlist_rate=shortlist_rate,
        ))
        score_buckets[level] = [round(e["score"]) for e in entries]

    # Stage funnel (overall)
    stage_counter: Counter = Counter()
    for _, cand in rows:
        stage_counter[getattr(cand, "stage", "applied")] += 1
    stage_funnel = [
        StageFunnelItem(stage=s, label=_STAGE_LABELS.get(s, s), count=stage_counter.get(s, 0))
        for s in _STAGE_ORDER
    ]

    # Top 15 locations
    top_locations = dict(location_counter.most_common(15))

    gender_fairness = _disparate_impact(rows, eval_latest_status, "gender_identity")
    ethnicity_fairness = _disparate_impact(rows, eval_latest_status, "ethnicity")

    return DiversityOut(
        total_candidates=total,
        by_experience_level=by_level,
        score_buckets_by_level=score_buckets,
        stage_progression=stage_funnel,
        location_counts=top_locations,
        gender_fairness=gender_fairness,
        ethnicity_fairness=ethnicity_fairness,
    )
