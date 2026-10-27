"""One-off: freeze a golden regression set from existing DB evaluations.

Pulls a spread of already-scored evaluations (low/mid/high, across job roles)
and writes each as a fixture under backend/tests/golden/*.json. The fixture
records today's score as the baseline — run this BEFORE swapping LLM_MODEL,
then run `pytest backend/tests/test_golden_regression.py` after the swap to
see exactly how much (and which skills) drifted.

Usage:
    cd backend && python scripts/freeze_golden_set.py [--count 20]

Note: Evaluation.total_score can include GitHub/LinkedIn enrichment modifiers
(see routers/evaluate.py _run_auto_enrichment) that score_resume() alone won't
reproduce. The regression test's tolerance band is sized to absorb that.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal
from app.models import Evaluation, JobRole, JobRoleSkill, Resume, ResumeVersion, Skill

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "tests" / "golden"
DEFAULT_TOLERANCE = 8


def _pick_spread(evaluations: list[Evaluation], count: int) -> list[Evaluation]:
    """Pick *count* evaluations spread across the score range, not just the first N."""
    if len(evaluations) <= count:
        return evaluations
    ordered = sorted(evaluations, key=lambda e: e.total_score)
    step = len(ordered) / count
    return [ordered[int(i * step)] for i in range(count)]


def main(count: int) -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    db = SessionLocal()
    try:
        candidates = (
            db.query(Evaluation)
            .filter(Evaluation.eval_status.is_(None))
            .all()
        )
        selected = _pick_spread(candidates, count)

        written = 0
        for ev in selected:
            resume = db.query(Resume).filter(Resume.id == ev.resume_id).first()
            job_role = db.query(JobRole).filter(JobRole.id == ev.job_role_id).first()
            if resume is None or job_role is None or not resume.sections:
                continue

            resume_version = db.query(ResumeVersion).filter(ResumeVersion.id == resume.id).first()
            candidate_years = None
            if resume_version and resume_version.candidate:
                candidate_years = resume_version.candidate.years_experience

            jrs_rows = db.query(JobRoleSkill).filter(JobRoleSkill.job_role_id == job_role.id).all()
            skill_ids = [r.skill_id for r in jrs_rows]
            required_map = {r.skill_id: r.is_required for r in jrs_rows}
            skills = db.query(Skill).filter(Skill.id.in_(skill_ids)).all()

            fixture = {
                "source_evaluation_id": ev.id,
                "sections": json.loads(resume.sections),
                "required_skills": [s.name for s in skills],
                "skill_required_flags": [required_map.get(s.id, True) for s in skills],
                "weights": {
                    "projects": job_role.weight_projects,
                    "skills": job_role.weight_skills,
                    "education": job_role.weight_education,
                },
                "cosine_threshold": job_role.cosine_threshold,
                "min_degree": job_role.min_degree,
                "preferred_majors": json.loads(job_role.preferred_majors) if job_role.preferred_majors else None,
                "jd_description": job_role.description,
                "candidate_years": candidate_years,
                "min_experience_years": int(job_role.min_experience or 0),
                "is_fresher": bool(getattr(job_role, "is_entry_level", False)),
                "expected_total_score": ev.total_score,
                "tolerance": DEFAULT_TOLERANCE,
                "scored_with_model": ev.llm_model,
            }

            out_path = GOLDEN_DIR / f"eval_{ev.id}.json"
            out_path.write_text(json.dumps(fixture, indent=2))
            written += 1

        print(f"Wrote {written} golden fixtures to {GOLDEN_DIR}")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=20)
    args = parser.parse_args()
    main(args.count)
