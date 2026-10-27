"""Golden regression suite — detects score drift when LLM_MODEL or the scoring
prompt changes.

Fixtures are frozen snapshots of real evaluations (see
scripts/freeze_golden_set.py), each recording the resume sections, job role
config, and the total_score produced by whichever model scored them at
freeze time.

Run this any time LLM_MODEL or app/services/llm_scorer.py's prompt/schema
changes, before merging:

    cd backend && pytest tests/test_golden_regression.py -v

A failure means the new model/prompt classified at least one skill
differently enough to move the total score outside tolerance — the per-skill
diff printed on failure shows exactly which skill and how.
"""
from __future__ import annotations

import json
import sys
from collections import namedtuple
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schemas import ScoringWeights
from app.services.scorer import score_resume
from app.services.segmenter import Section

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"
_SkillStub = namedtuple("_SkillStub", ["name"])


def _load_fixtures():
    if not GOLDEN_DIR.exists():
        return []
    return sorted(GOLDEN_DIR.glob("*.json"))


FIXTURE_PATHS = _load_fixtures()

if not FIXTURE_PATHS:
    pytest.skip(
        "No golden fixtures found — run scripts/freeze_golden_set.py to seed tests/golden/",
        allow_module_level=True,
    )


@pytest.mark.parametrize("fixture_path", FIXTURE_PATHS, ids=lambda p: p.stem)
def test_golden_score_within_tolerance(fixture_path):
    fixture = json.loads(fixture_path.read_text())

    sections = [
        Section(
            type=s["type"],
            title=s.get("title", ""),
            start_line=s.get("start_line", 0),
            end_line=s.get("end_line", 0),
            text=s.get("text", ""),
            confidence=s.get("confidence", 1.0),
            weight_multiplier=s.get("weight_multiplier", 0.5),
        )
        for s in fixture["sections"]
    ]
    required_skills = [_SkillStub(name=n) for n in fixture["required_skills"]]
    weights = ScoringWeights(**fixture["weights"])

    result = score_resume(
        sections=sections,
        required_skills=required_skills,
        weights=weights,
        cosine_threshold=fixture["cosine_threshold"],
        jd_description=fixture.get("jd_description"),
        min_degree=fixture.get("min_degree"),
        preferred_majors=fixture.get("preferred_majors"),
        skill_required_flags=fixture.get("skill_required_flags"),
        candidate_years=fixture.get("candidate_years"),
        min_experience_years=fixture.get("min_experience_years", 0),
        is_fresher=fixture.get("is_fresher", False),
    )

    expected = fixture["expected_total_score"]
    tolerance = fixture.get("tolerance", 8)
    diff = abs(result.total - expected)

    if diff > tolerance:
        skill_diff = (
            f"skills_matched now: {[sm.skill_name for sm in result.skills_matched]}\n"
            f"skill_gaps now: {result.skill_gaps}\n"
            f"divergent_skills (embedding cross-check flags): {result.divergent_skills}"
        )
        pytest.fail(
            f"{fixture_path.name}: score drifted {diff:.1f} pts "
            f"(expected {expected}, got {result.total}, tolerance {tolerance}).\n{skill_diff}"
        )
