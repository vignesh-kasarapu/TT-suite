"""LLM-based skill scoring service.

Sends resume sections + required skills to any OpenAI-compatible LLM endpoint
and parses a structured JSON response containing per-skill tier/proficiency
classifications. The LLM is only asked to *classify* each skill into a
discrete tier — the actual numeric score is computed deterministically in
Python (see TIER_BASE_SCORE / PROFICIENCY_BONUS below and
scorer._build_result_from_llm) so that swapping models changes classification
accuracy, not the scoring formula.

Supported providers (set LLM_BASE_URL + LLM_MODEL in .env):
  - OpenAI          base_url=https://api.openai.com/v1      model=gpt-4o-mini
  - Anthropic       base_url=https://api.anthropic.com/v1   model=claude-3-5-haiku-20241022
  - Groq            base_url=https://api.groq.com/openai/v1 model=llama-3-8b-8192
  - Together AI     base_url=https://api.together.xyz/v1    model=mistralai/Mixtral-8x7B
  - Ollama (local)  base_url=http://localhost:11434/v1       model=llama3

Falls back gracefully to TF-IDF scorer when:
  - LLM_API_KEY is not set
  - The API call fails or times out
  - The response cannot be parsed as valid JSON or fails schema validation
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Literal, Optional

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Prompt / schema version — bump whenever _SYSTEM_PROMPT, _USER_TEMPLATE, or
# LLMSkillResult changes shape. Stamped on every Evaluation row so scores can
# be traced back to exactly which prompt produced them.
# ---------------------------------------------------------------------------

PROMPT_VERSION = "v2-categorical"

# ---------------------------------------------------------------------------
# Deterministic scoring table — moves the scoring *formula* out of the LLM's
# hands. The LLM only classifies; Python does the math. This is what keeps
# scores stable across model swaps: two different models classifying the same
# skill the same way produce byte-identical scores.
# ---------------------------------------------------------------------------

TIER_BASE_SCORE: dict[str, int] = {
    "skills_section": 94,
    "project_experience": 81,
    "education_coursework": 64,
    "implied_not_named": 39,
    "not_present": 10,
}

PROFICIENCY_BONUS: dict[str, int] = {
    "expert": 12,
    "proficient": 7,
    "familiar": 3,
    "none": 0,
}

_TIER_VALUES = tuple(TIER_BASE_SCORE.keys())
_PROFICIENCY_VALUES = tuple(PROFICIENCY_BONUS.keys())


def detect_llm_provider(base_url: str) -> str:
    """Best-effort provider name from the configured base_url, for auditing/display only."""
    url = (base_url or "").lower()
    if "groq" in url:
        return "groq"
    if "openai" in url:
        return "openai"
    if "anthropic" in url:
        return "anthropic"
    if "together" in url:
        return "together"
    if "generativelanguage.googleapis.com" in url:
        return "gemini"
    if "localhost" in url or "127.0.0.1" in url:
        return "ollama"
    return "unknown"


class LLMSkillResult(BaseModel):
    """Strict schema for one skill classification returned by the LLM."""

    name: str
    tier: Literal["skills_section", "project_experience", "education_coursework",
                   "implied_not_named", "not_present"]
    proficiency: Literal["expert", "proficient", "familiar", "none"]
    confidence: Literal["high", "medium", "low"]
    section: str = "unknown"
    excerpt: Optional[str] = None


# ---------------------------------------------------------------------------
# Prompt template
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are an expert technical recruiter classifying resume content.
You will receive a list of required skills and extracted resume sections.
Respond ONLY with a valid JSON object — no markdown, no explanation.
""".strip()

_USER_TEMPLATE = """\
Required skills:
{skills_list}

Resume sections:
{sections_text}

For each required skill return an object with:
  "name"         : exact skill name as given
  "tier"         : one of:
      "skills_section"        — skill explicitly named in a Technical Skills / Skills /
                                 Programming Languages / Databases / Frameworks section
                                 (verbatim or near-verbatim match)
      "project_experience"    — skill clearly used in a project, role, or work experience bullet
      "education_coursework"  — skill mentioned in education, certification, or coursework context
      "implied_not_named"     — skill indirectly implied but never explicitly named
      "not_present"           — skill not present in the resume at all
  "proficiency"  : one of "expert" | "proficient" | "familiar" | "none"
      Only set above "none" when the candidate explicitly states a proficiency level for THIS
      skill within the same sentence/bullet as the skill mention:
        "expert"     — "expert", "advanced", "lead-level", "principal-level"
                        e.g. "Expert in React", "Advanced Python developer"
        "proficient" — "proficient", "intermediate", "experienced with"
                        e.g. "Proficient in SQL", "3+ years of intermediate Django"
        "familiar"   — "familiar", "basic", "exposure to", "some experience with"
                        e.g. "Familiar with Kubernetes", "Basic knowledge of Docker"
  "confidence"   : "high" | "medium" | "low"
                   high   = led/architected/built/deployed, or explicitly in skills section
                   medium = used/applied/maintained in projects or experience
                   low    = mentioned in passing / education context only
  "section"      : "projects" | "skills" | "experience" | "education" | "unknown"
  "excerpt"      : shortest relevant quote (<=120 chars) or null

Worked examples:

  Resume snippet: "[SKILLS]\\nPython, React, PostgreSQL"
  Required skill: "Python"
  -> {{"name": "Python", "tier": "skills_section", "proficiency": "none",
       "confidence": "high", "section": "skills", "excerpt": "Python, React, PostgreSQL"}}

  Resume snippet: "[PROJECTS]\\nBuilt a REST API in Django to serve ML predictions."
  Required skill: "Django"
  -> {{"name": "Django", "tier": "project_experience", "proficiency": "none",
       "confidence": "medium", "section": "projects", "excerpt": "Built a REST API in Django"}}

Return exactly:
{{"skills": [ ... ]}}
""".strip()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_sections_text(sections: list) -> str:
    """Render section list to a compact plain-text block for the prompt."""
    parts: list[str] = []
    for s in sections:
        header = f"[{s.type.upper()}]"
        body = (s.text or "").strip()[:1200]   # cap per-section to keep prompt small
        if body:
            parts.append(f"{header}\n{body}")
    return "\n\n".join(parts) or "(no sections detected)"


def _parse_llm_response(raw: str) -> list[LLMSkillResult]:
    """Extract and strictly validate the skills array from the LLM JSON response."""
    # Strip markdown code fences if the model wrapped it
    text = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()

    data = json.loads(text)
    if isinstance(data, dict) and "skills" in data:
        items = data["skills"]
    elif isinstance(data, list):
        items = data
    else:
        raise ValueError(f"Unexpected response shape: {list(data.keys()) if isinstance(data, dict) else type(data)}")

    return [LLMSkillResult.model_validate(item) for item in items]


def _skill_json_schema() -> dict[str, Any]:
    """Build a {"skills": [...]} JSON schema from LLMSkillResult for strict response_format."""
    item_schema = LLMSkillResult.model_json_schema()
    return {
        "type": "object",
        "properties": {
            "skills": {"type": "array", "items": item_schema},
        },
        "required": ["skills"],
        "additionalProperties": False,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def score_with_llm(
    sections: list,
    required_skills: list,
    cosine_threshold: float,
) -> Optional[list[dict[str, Any]]]:
    """Call the configured LLM to classify resume skills.

    Returns a list of skill dicts on success, or None if the LLM is not
    configured / unavailable (caller should fall back to TF-IDF).

    Each dict contains: name, tier, proficiency, confidence, section, excerpt.
    """
    from app.config import settings

    if not settings.llm_api_key:
        return None   # LLM not configured — use TF-IDF

    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=settings.llm_timeout,
        )

        skills_list = "\n".join(f"- {sk.name}" for sk in required_skills)
        sections_text = _build_sections_text(sections)

        user_content = _USER_TEMPLATE.format(
            skills_list=skills_list,
            sections_text=sections_text,
        )

        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

        try:
            response = client.chat.completions.create(  # type: ignore
                model=settings.llm_model,
                messages=messages,
                temperature=0.0,       # deterministic classification
                max_tokens=1024,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "skill_classification", "schema": _skill_json_schema(), "strict": True},
                },
            )
        except Exception:
            # Provider doesn't support json_schema mode (e.g. some Groq/Together/Ollama
            # deployments) — degrade to the looser but more widely supported json_object mode.
            # Pydantic validation below is the real enforcement either way.
            response = client.chat.completions.create(  # type: ignore
                model=settings.llm_model,
                messages=messages,
                temperature=0.0,
                max_tokens=1024,
                response_format={"type": "json_object"},
            )

        raw = response.choices[0].message.content or ""
        parsed = _parse_llm_response(raw)
        return [item.model_dump() for item in parsed]

    except ValidationError as exc:
        logger.warning("LLM scorer response failed schema validation (%s) — falling back to TF-IDF", exc)
        return None
    except Exception as exc:
        logger.warning("LLM scorer failed (%s) — falling back to TF-IDF", exc)
        return None
