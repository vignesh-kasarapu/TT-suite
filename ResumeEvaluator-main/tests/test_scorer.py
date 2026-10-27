from unittest.mock import patch
import pytest
from app.services.segmenter import Section
from app.schemas import ScoringWeights
from app.services.scorer import score_resume


class DummySkill:
    def __init__(self, name, embedding=None):
        self.name = name
        self.embedding = embedding


def test_score_resume_weights_error():
    # Weights not summing to 100 should raise ValueError
    weights = ScoringWeights(projects=50, skills=30, education=10)  # Sums to 90
    with pytest.raises(ValueError):
        score_resume(
            sections=[],
            required_skills=[],
            weights=weights,
            cosine_threshold=0.70,
        )


@patch("app.services.llm_scorer.score_with_llm", return_value=None)
def test_score_resume_logic(mock_score_with_llm):
    # score_resume tries the LLM scorer first and falls back to the keyword/TF-IDF
    # scorer when it returns None — force that path so this test is deterministic
    # and doesn't depend on network access or a configured LLM key.
    sections = [
        Section(
            type="projects",
            title="Projects",
            start_line=1,
            end_line=3,
            text="Built a recommendation engine in Python and deployed it to production.",
            confidence=1.0,
            weight_multiplier=1.0,
        ),
        Section(
            type="education",
            title="Education",
            start_line=5,
            end_line=6,
            text="Bachelor of Science in Computer Science.",
            confidence=1.0,
            weight_multiplier=0.4,
        ),
    ]

    required_skills = [
        DummySkill(name="Python"),   # appears verbatim in the projects section
        DummySkill(name="Rust"),     # never mentioned anywhere — should be a gap
    ]

    weights = ScoringWeights(projects=50, skills=30, education=20)

    result = score_resume(
        sections=sections,
        required_skills=required_skills,
        weights=weights,
        cosine_threshold=0.70,
    )

    matched_names = [m.skill_name for m in result.skills_matched]
    assert "Python" in matched_names
    assert "Rust" not in matched_names
    assert "Rust" in result.skill_gaps

    # Python's evidence should come from the projects section
    python_match = next(m for m in result.skills_matched if m.skill_name == "Python")
    assert python_match.best_section == "projects"
    assert result.top_excerpt is not None
