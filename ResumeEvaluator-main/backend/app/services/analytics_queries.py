"""Shared query helpers for analytics endpoints and the report builder.

Extracted from routers/analytics.py, where these two patterns were
duplicated verbatim across get_analytics and get_diversity_analytics.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Query, Session

from app.models import Candidate, Evaluation, ResumeVersion, Shortlist


def active_evaluations_query(db: Session, job_role_id: Optional[int] = None) -> Query:
    """Evaluation+Candidate pairs for current, non-deleted resume versions.

    Includes both LLM-scored evaluations and auto-rejected ones
    (tfidf_filtered/experience_filtered) — callers that need LLM-scored-only
    rows should filter `Evaluation.eval_status.is_(None)` further.
    """
    q = (
        db.query(Evaluation, Candidate)
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
        q = q.filter(Evaluation.job_role_id == job_role_id)
    return q


def latest_shortlist_status(db: Session, evaluation_ids: List[int]) -> Dict[int, str]:
    """Latest (by changed_at) Shortlist.status per evaluation id.

    Shortlist history is intentionally append-only, so outerjoining it
    directly into a main query would duplicate rows once per history entry —
    batch-fetch and reduce in Python instead.
    """
    if not evaluation_ids:
        return {}
    sl_by_eval: Dict[int, list] = defaultdict(list)
    for sl in db.query(Shortlist).filter(Shortlist.evaluation_id.in_(evaluation_ids)).all():
        sl_by_eval[sl.evaluation_id].append(sl)
    return {
        eid: max(sls, key=lambda s: s.changed_at).status
        for eid, sls in sl_by_eval.items()
    }
