import logging
import math
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_db, require_staff
from app.models import Skill, User
from app.schemas import SkillCreate, SkillOut

logger = logging.getLogger(__name__)


class _JdExtractRequest(BaseModel):
    text: str

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=dict)
def list_skills(
    category: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return a paginated list of skills, optionally filtered by category and/or search term."""
    query = db.query(Skill)

    if category:
        query = query.filter(Skill.category == category)

    if search:
        query = query.filter(Skill.name.ilike(f"%{search}%"))

    total = query.count()
    skills = query.offset((page - 1) * limit).limit(limit).all()
    pages = math.ceil(total / limit) if total > 0 else 1

    return {
        "items": [SkillOut.model_validate(s) for s in skills],
        "total": total,
        "page": page,
        "limit": limit,
        "pages": pages,
    }


@router.post("", response_model=SkillOut, status_code=status.HTTP_201_CREATED)
def create_skill(
    body: SkillCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> SkillOut:
    """Create a new skill and immediately compute + store its embedding.

    Raises:
        HTTPException 409: If a skill with the same name already exists.
    """
    existing = db.query(Skill).filter(Skill.name == body.name).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Skill '{body.name}' already exists",
        )

    skill = Skill(
        name=body.name,
        category=body.category,
        embedding=None,
    )
    db.add(skill)
    db.commit()
    db.refresh(skill)

    return SkillOut.model_validate(skill)


_KNOWN_TECH_SKILLS: List[tuple] = [
    # Languages
    ("Python", "language"), ("JavaScript", "language"), ("TypeScript", "language"),
    ("Java", "language"), ("C++", "language"), ("C#", "language"), ("Go", "language"),
    ("Rust", "language"), ("Ruby", "language"), ("PHP", "language"), ("Swift", "language"),
    ("Kotlin", "language"), ("Scala", "language"), ("R", "language"), ("MATLAB", "language"),
    ("Bash", "language"), ("Shell Scripting", "language"), ("SQL", "language"),
    # Web Frameworks
    ("React", "framework"), ("Vue", "framework"), ("Angular", "framework"),
    ("Next.js", "framework"), ("FastAPI", "framework"), ("Flask", "framework"),
    ("Django", "framework"), ("Node.js", "framework"), ("Express", "framework"),
    ("Spring Boot", "framework"), ("Laravel", "framework"), ("Rails", "framework"),
    ("Svelte", "framework"), ("Tailwind CSS", "framework"), ("Bootstrap", "framework"),
    # AI/ML
    ("TensorFlow", "framework"), ("PyTorch", "framework"), ("Keras", "framework"),
    ("Scikit-learn", "library"), ("LangChain", "library"), ("Hugging Face", "library"),
    ("OpenAI API", "library"), ("spaCy", "library"), ("NLTK", "library"),
    ("Machine Learning", "skill"), ("Deep Learning", "skill"),
    ("Natural Language Processing", "skill"), ("Computer Vision", "skill"),
    ("Large Language Models", "skill"), ("RAG", "skill"), ("LLMs", "skill"),
    ("Reinforcement Learning", "skill"), ("Data Science", "skill"),
    ("Generative AI", "skill"), ("Prompt Engineering", "skill"),
    ("Transformers", "library"), ("Vector Databases", "skill"),
    # Databases
    ("PostgreSQL", "database"), ("MySQL", "database"), ("MongoDB", "database"),
    ("Redis", "database"), ("SQLite", "database"), ("Cassandra", "database"),
    ("Elasticsearch", "database"), ("DynamoDB", "database"), ("Firebase", "database"),
    # DevOps / Cloud
    ("Docker", "devops"), ("Kubernetes", "devops"), ("CI/CD", "devops"),
    ("GitHub Actions", "devops"), ("Jenkins", "devops"), ("Terraform", "devops"),
    ("Ansible", "devops"), ("AWS", "cloud"), ("Azure", "cloud"), ("GCP", "cloud"),
    ("Linux", "devops"), ("Git", "devops"), ("GitHub", "devops"), ("GitLab", "devops"),
    # Data Engineering
    ("Apache Spark", "data"), ("Apache Kafka", "data"), ("Airflow", "data"),
    ("Pandas", "library"), ("NumPy", "library"), ("Matplotlib", "library"),
    ("Jupyter", "tool"), ("Databricks", "data"),
    # APIs / Protocols
    ("REST API", "skill"), ("GraphQL", "skill"), ("WebSockets", "skill"),
    ("gRPC", "skill"), ("OAuth", "skill"), ("JWT", "skill"),
    # Other tools
    ("Figma", "tool"), ("Postman", "tool"), ("Jira", "tool"), ("Agile", "skill"),
    ("Microservices", "skill"), ("System Design", "skill"), ("Data Structures", "skill"),
    ("Algorithms", "skill"), ("OOP", "skill"), ("Functional Programming", "skill"),
]

# Normalised aliases so "sklearn" → "scikit-learn", "nodejs" → "node.js", etc.
_JD_SKILL_ALIASES: dict[str, str] = {
    "sklearn": "Scikit-learn", "scikit learn": "Scikit-learn",
    "nodejs": "Node.js", "node js": "Node.js", "node": "Node.js",
    "reactjs": "React", "react.js": "React",
    "vuejs": "Vue", "vue.js": "Vue",
    "angularjs": "Angular",
    "postgres": "PostgreSQL", "psql": "PostgreSQL",
    "mongo": "MongoDB",
    "k8s": "Kubernetes",
    "llm": "Large Language Models", "llms": "Large Language Models",
    "rag": "RAG", "retrieval augmented generation": "RAG",
    "nlp": "Natural Language Processing",
    "ml": "Machine Learning",
    "dl": "Deep Learning",
    "ci/cd": "CI/CD", "cicd": "CI/CD", "continuous integration": "CI/CD",
    "genai": "Generative AI", "generative ai": "Generative AI",
    "langchain": "LangChain",
    "huggingface": "Hugging Face",
    "gcp": "GCP", "google cloud": "GCP",
    "fastapi": "FastAPI", "flask": "Flask",
    "nextjs": "Next.js", "next.js": "Next.js",
    "springboot": "Spring Boot",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
}


_VALID_SKILL_CATEGORIES = {"language", "framework", "library", "database", "devops", "cloud", "data", "tool", "skill"}


def _extract_skills_via_llm(text: str) -> list[dict]:
    """Ask the configured LLM to extract skills from a JD text.

    Returns a list of {"name": str, "category": str} dicts.
    Returns an empty list if LLM is not configured or the call fails.
    """
    try:
        from app.config import settings
        if not settings.llm_api_key:
            return []
    except Exception:
        return []

    try:
        import json as _json
        import re as _re
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=float(settings.llm_timeout),
        )

        sample = text[:6000]
        prompt = (
            "Extract all technical skills, tools, frameworks, and technologies from this job description. "
            "Return ONLY valid JSON:\n"
            '{"skills":[{"name":"Python","category":"language","is_required":true},...]}\n\n'
            f"Categories must be one of: {', '.join(sorted(_VALID_SKILL_CATEGORIES))}\n\n"
            "Set is_required=true for skills that appear under 'Must have', 'Required', 'Mandatory', or similar headings.\n"
            "Set is_required=false for skills that appear under 'Good-to-have', 'Good to have', 'Nice-to-have', "
            "'Nice to have', 'Preferred', 'Bonus', 'Plus', 'Optional', or similar headings.\n"
            "If the JD uses section headings, classify ALL skills under that heading accordingly.\n"
            "Default to is_required=true only when there are no section signals at all.\n\n"
            f"Job description:\n{sample}"
        )

        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=800,
        )

        content = (response.choices[0].message.content or "").strip()
        content = _re.sub(r"^```[a-z]*\n?", "", content)
        content = _re.sub(r"\n?```$", "", content).strip()

        json_match = _re.search(r"\{.*\}", content, _re.DOTALL)
        if not json_match:
            return []

        data = _json.loads(json_match.group())
        result = []
        for s in data.get("skills", []):
            if not isinstance(s, dict) or not s.get("name"):
                continue
            cat = s.get("category", "skill")
            if cat not in _VALID_SKILL_CATEGORIES:
                cat = "skill"
            result.append({"name": str(s["name"]).strip(), "category": cat, "is_required": bool(s.get("is_required", True))})

        logger.debug("LLM extracted %d skills from JD", len(result))
        return result

    except Exception as exc:
        logger.error("LLM skill extraction failed: %s", exc, exc_info=True)
        return []


def _classify_skills_by_section(text: str) -> dict[str, bool]:
    """Return {canonical_skill_lower: is_required} by parsing must-have / nice-to-have section headers.

    Works without an LLM.  Returns an empty dict when no clear section markers
    are found so the caller can fall back to its own defaults.
    """
    import re as _re

    _REQUIRED_HDR = _re.compile(
        r'(?:must[\s\-]have|required\s*:?|mandatory|key\s+skills?|'
        r'essential|qualifications?\s*:?|required\s+skills?|'
        r'technical\s+foundation|expected\s+skills?|core\s+skills?|'
        r'what\s+(?:we\s+)?(?:need|look\s+for|require)\s*:?)',
        _re.I,
    )
    _OPTIONAL_HDR = _re.compile(
        r'(?:good[\s\-]to[\s\-]have|nice[\s\-]to[\s\-]have|preferred\s*:?|'
        r'bonus\s*:?|a\s+plus|optional\s*:?|would\s+be\s+(?:great|nice|a\s+plus)|'
        r'added\s+advantage|desirable\s*:?|advantage(?:ous)?)',
        _re.I,
    )

    # Collect all section boundary positions with their is_required flag
    boundaries: list[tuple[int, bool]] = []
    for m in _REQUIRED_HDR.finditer(text):
        boundaries.append((m.start(), True))
    for m in _OPTIONAL_HDR.finditer(text):
        boundaries.append((m.start(), False))

    if not boundaries:
        return {}

    boundaries.sort(key=lambda x: x[0])
    boundaries.append((len(text), None))  # sentinel

    result: dict[str, bool] = {}

    for i, (sec_start, is_req) in enumerate(boundaries[:-1]):
        if is_req is None:
            continue
        sec_text = text[sec_start: boundaries[i + 1][0]]
        sec_lower = sec_text.lower()

        for display_name, _ in _KNOWN_TECH_SKILLS:
            dn_lower = display_name.lower()
            if len(display_name) <= 2:
                pattern = _re.compile(r'(?<![A-Za-z0-9])' + _re.escape(display_name) + r'(?![A-Za-z0-9])')
                if pattern.search(sec_text):
                    if dn_lower not in result or (is_req and not result[dn_lower]):
                        result[dn_lower] = is_req
                continue
            pattern = _re.compile(r'(?<![a-z0-9])' + _re.escape(dn_lower) + r'(?![a-z0-9])', _re.I)
            if pattern.search(sec_lower):
                # If a skill appears in both sections keep the required flag
                if dn_lower not in result or (is_req and not result[dn_lower]):
                    result[dn_lower] = is_req

        for alias, canonical in _JD_SKILL_ALIASES.items():
            pattern = _re.compile(r'(?<![a-z0-9])' + _re.escape(alias) + r'(?![a-z0-9])', _re.I)
            if pattern.search(sec_lower):
                c_lower = canonical.lower()
                if c_lower not in result or (is_req and not result[c_lower]):
                    result[c_lower] = is_req

    return result


def _extract_jd_metadata_rule_based(text: str) -> dict:
    """Extract job role metadata from JD text using regex — no LLM required."""
    import re as _re

    # ── Title ────────────────────────────────────────────────────────────────
    title: str | None = None
    # Common patterns: "Hiring: <title>", "Role: <title>", first short meaningful line
    title_patterns = [
        _re.compile(r'(?:hiring|role|position|job\s*title)\s*[:\-]\s*(.+)', _re.I),
        _re.compile(r'^(?:we(?:\'re|\s+are)\s+hiring\s*[:\-]?\s*)(.+)', _re.I | _re.M),
    ]
    for pat in title_patterns:
        m = pat.search(text)
        if m:
            candidate = m.group(1).strip().rstrip('.')
            # Strip trailing date/year noise like "(July 2026)"
            candidate = _re.sub(r'\s*\([^)]*\d{4}[^)]*\)', '', candidate).strip()
            if 3 < len(candidate) < 120:
                title = candidate
                break

    if not title:
        # Fall back to the first short non-boilerplate line
        _BOILERPLATE = _re.compile(
            r'^(?:we\s+are|our\s+|about\s+|this\s+program|this\s+role|'
            r'as\s+an?\s+|the\s+details|interested|please|start\s*:)',
            _re.I,
        )
        for line in text.splitlines():
            line = line.strip()
            if 6 < len(line) < 100 and not _BOILERPLATE.match(line):
                # Strip trailing noise like "(July 2026)"
                candidate = _re.sub(r'\s*\([^)]*\d{4}[^)]*\)', '', line).strip()
                if candidate:
                    title = candidate
                    break

    # ── Min / max experience ─────────────────────────────────────────────────
    min_exp = 0
    max_exp: int | None = None
    # Range form first: "3-8 years", "6–8 years of experience"
    range_m = _re.search(
        r'(\d+)\s*(?:-|–|—|to)\s*(\d+)\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?(?:experience|exp)',
        text, _re.I,
    )
    if range_m:
        min_exp = int(range_m.group(1))
        max_exp = int(range_m.group(2))
    else:
        exp_m = _re.search(
            r'(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?(?:experience|exp)',
            text, _re.I,
        )
        if exp_m:
            min_exp = int(exp_m.group(1))

    # ── Experience level & entry-level flag ─────────────────────────────────
    tl = text.lower()
    is_entry = bool(_re.search(
        r'\b(?:intern(?:ship)?|fresher|fresh\s+graduate|entry[\s\-]level|'
        r'new\s+grad|graduate\s+(?:program|hire|role)|'
        r'0[\s\-](?:to|-)[\s\-]?\d\s*years?)\b',
        tl,
    ))
    is_senior = bool(_re.search(
        r'\b(?:senior|lead|principal|staff\s+engineer|tech\s+lead|'
        r'solution\s+architect|engineering\s+manager)\b',
        tl,
    ))
    is_executive = bool(_re.search(
        r'\b(?:director|vp\b|vice\s+president|c(?:to|eo|oo|po)|'
        r'head\s+of\s+engineering|chief\s+\w+\s+officer)\b',
        tl,
    ))

    if is_entry:
        filter_levels = ["junior"]
    elif is_executive:
        filter_levels = ["senior", "executive"] if is_senior else ["executive"]
    elif is_senior:
        filter_levels = ["senior"]
    elif min_exp >= 3:
        filter_levels = ["mid", "senior"]
    elif min_exp > 0:
        filter_levels = ["mid"]
    else:
        filter_levels = []

    return {
        "title": title,
        "min_experience": min_exp,
        "max_experience": max_exp,
        "filter_experience_levels": filter_levels,
        "is_entry_level": is_entry,
    }


@router.post("/extract-from-jd")
def extract_skills_from_jd(
    body: _JdExtractRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> dict:
    """Extract skills mentioned in the JD text.

    Scans the text against a built-in list of known tech skills AND existing
    DB skills.  Missing skills are auto-created so the caller always gets
    usable IDs back.
    """
    import re as _re

    text = body.text
    if not text or not text.strip():
        return {"skill_ids": [], "skill_names": [], "skill_required": []}

    text_lower = text.lower()
    found_canonical: dict[str, str] = {}        # canonical_lower → display_name
    found_is_required: dict[str, bool] = {}     # canonical_lower → is_required flag

    # 1. Match against the built-in known-skills list (all rule-based hits default to required)
    for display_name, category in _KNOWN_TECH_SKILLS:
        dn_lower = display_name.lower()
        if len(display_name) <= 2:
            # Short names ("Go", "R", "C") collide with common English words when
            # matched case-insensitively (e.g. "go-to-market", "ready to go").
            # Require exact-case match against the original text instead.
            pattern = _re.compile(r'(?<![A-Za-z0-9])' + _re.escape(display_name) + r'(?![A-Za-z0-9])')
            if pattern.search(text):
                found_canonical[dn_lower] = display_name
                found_is_required.setdefault(dn_lower, True)
            continue
        # word-boundary search (handles "React" not matching "Reactive")
        pattern = _re.compile(r'(?<![a-z0-9])' + _re.escape(dn_lower) + r'(?![a-z0-9])', _re.I)
        if pattern.search(text_lower):
            found_canonical[dn_lower] = display_name
            found_is_required.setdefault(dn_lower, True)

    # 2. Match aliases → canonical
    for alias, canonical in _JD_SKILL_ALIASES.items():
        pattern = _re.compile(r'(?<![a-z0-9])' + _re.escape(alias) + r'(?![a-z0-9])', _re.I)
        if pattern.search(text_lower):
            found_canonical[canonical.lower()] = canonical
            found_is_required.setdefault(canonical.lower(), True)

    # 2b. Section-based classification (rule-based, no LLM) — overrides naive defaults
    section_flags = _classify_skills_by_section(text)
    for sk_lower, is_req in section_flags.items():
        if sk_lower in found_canonical:
            found_is_required[sk_lower] = is_req

    # 2c. LLM-based dynamic skill extraction (merges and overwrites rule-based default hits)
    llm_category_extras: dict[str, str] = {}  # name_lower → category for LLM-only skills
    for s in _extract_skills_via_llm(text):
        name_lower = s["name"].lower()
        is_req = bool(s.get("is_required", True))
        # Resolve through alias table first
        canonical = _JD_SKILL_ALIASES.get(name_lower)
        if canonical:
            found_canonical[canonical.lower()] = canonical
            llm_category_extras[canonical.lower()] = s["category"]
            # LLM classification takes priority and overrides naive rule default
            found_is_required[canonical.lower()] = is_req
        else:
            found_canonical[name_lower] = s["name"]
            llm_category_extras[name_lower] = s["category"]
            found_is_required[name_lower] = is_req

    # 3. Also check existing DB skills via keyword scorer
    from app.services.scorer import _keyword_score_in_text
    all_skills = db.query(Skill).all()
    existing_by_lower = {s.name.lower(): s for s in all_skills}
    for skill in all_skills:
        if _keyword_score_in_text(skill.name, text) >= 0.85:
            found_canonical[skill.name.lower()] = skill.name
            found_is_required.setdefault(skill.name.lower(), True)

    if not found_canonical:
        return {"skill_ids": [], "skill_names": [], "skill_required": []}

    # 4. Upsert: look up each found skill, create if missing
    matched_ids: List[int] = []
    matched_names: List[str] = []
    matched_required: List[bool] = []

    # Build category map: known list + LLM hints (known list takes precedence)
    category_map = {name.lower(): cat for name, cat in _KNOWN_TECH_SKILLS}
    for k, v in llm_category_extras.items():
        category_map.setdefault(k, v)

    for dn_lower, display_name in found_canonical.items():
        existing = existing_by_lower.get(dn_lower)
        if not existing:
            # Try case-insensitive DB lookup
            existing = db.query(Skill).filter(Skill.name.ilike(dn_lower)).first()
        if existing:
            matched_ids.append(existing.id)
            matched_names.append(existing.name)
        else:
            # Auto-create
            category = category_map.get(dn_lower, "skill")
            new_skill = Skill(name=display_name, category=category, embedding=None)
            db.add(new_skill)
            db.flush()
            matched_ids.append(new_skill.id)
            matched_names.append(display_name)
        matched_required.append(found_is_required.get(dn_lower, True))

    db.commit()
    return {"skill_ids": matched_ids, "skill_names": matched_names, "skill_required": matched_required}


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_skill(
    skill_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> None:
    """Delete a skill by ID.

    Raises:
        HTTPException 404: If the skill is not found.
    """
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if skill is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Skill {skill_id} not found",
        )

    db.delete(skill)
    db.commit()


class _JdMetadataRequest(BaseModel):
    text: str


class _JdMetadataResponse(BaseModel):
    title: Optional[str] = None
    min_experience: int = 0
    max_experience: Optional[int] = None
    filter_experience_levels: List[str] = []
    is_entry_level: bool = False


class _JdSkillItem(BaseModel):
    name: str
    category: Optional[str] = None
    is_required: bool = True


class _JdFullConfigResponse(BaseModel):
    """All auto-fillable job role config fields extracted from a JD in one LLM call."""
    title: Optional[str] = None
    min_experience: int = 0
    max_experience: Optional[int] = None
    filter_experience_levels: List[str] = []
    is_entry_level: bool = False
    # Listing / posting details
    work_type: Optional[str] = None           # "remote" | "onsite" | "hybrid"
    employment_type: Optional[str] = None     # "full_time" | "part_time" | "contract" | "internship"
    department: Optional[str] = None
    job_location: Optional[str] = None
    salary_min: Optional[int] = None          # LPA (India) or annual USD
    salary_max: Optional[int] = None
    # Candidate requirements
    min_degree: Optional[str] = None          # "bachelor" | "master" | "phd" | "doctorate"
    preferred_majors: List[str] = []
    require_github: bool = False
    # Graduation year range (for fresher / cohort intakes)
    min_graduation_year: Optional[int] = None
    max_graduation_year: Optional[int] = None
    # Populated only by extract-full-config-from-file (parsed from an uploaded JD file)
    skills: List[_JdSkillItem] = []
    metadata: Optional[_JdMetadataResponse] = None


def _extract_full_config_via_llm(text: str) -> dict:
    """Ask the LLM to extract ALL job config fields from a JD text in one call.

    Returns a dict matching _JdFullConfigResponse fields.
    Falls back to empty dict when LLM is unavailable.
    """
    try:
        from app.config import settings
        if not settings.llm_api_key:
            return {}
    except Exception:
        return {}

    try:
        import json as _json
        import re as _re
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=float(settings.llm_timeout),
        )

        sample = text[:8000]
        prompt = (
            "Analyze this job description and extract ALL job configuration fields. "
            "Return ONLY valid JSON with this EXACT schema (use null for fields you cannot determine):\n"
            "{\n"
            '  "title": "Senior ML Engineer",\n'
            '  "min_experience": 3,\n'
            '  "max_experience": null,\n'
            '  "filter_experience_levels": ["mid", "senior"],\n'
            '  "is_entry_level": false,\n'
            '  "work_type": "hybrid",\n'
            '  "employment_type": "full_time",\n'
            '  "department": "Engineering",\n'
            '  "job_location": "Hyderabad, India",\n'
            '  "salary_min": null,\n'
            '  "salary_max": null,\n'
            '  "min_degree": "bachelor",\n'
            '  "preferred_majors": ["Computer Science", "Electronics"],\n'
            '  "require_github": false,\n'
            '  "min_graduation_year": null,\n'
            '  "max_graduation_year": null\n'
            "}\n\n"
            "RULES:\n"
            '1. title: Concise job title (e.g. "Backend Engineer", "AI Product Engineering Intern").\n'
            '2. min_experience: Integer years. 0 for intern/fresher roles. '
            'If the JD gives a range like "3-8 years" or "6–8 years", set min_experience to the '
            'lower bound and max_experience to the upper bound.\n'
            '2b. max_experience: Integer years, the upper bound of an experience range. '
            'null if the JD states only a minimum with no upper bound (e.g. "5+ years").\n'
            '3. filter_experience_levels: ONLY values from ["junior","mid","senior","executive"]. '
            'Intern/fresher/entry-level → ["junior"]. Lead/Staff/Principal → ["senior"]. '
            'Director/VP/C-level → ["executive"]. Empty [] when not specified.\n'
            '4. is_entry_level: true for intern, fresher, entry-level, fresh graduate roles.\n'
            '5. work_type: "remote", "onsite", or "hybrid". null if not mentioned.\n'
            '6. employment_type: "full_time", "part_time", "contract", or "internship". null if unclear.\n'
            '7. department: e.g. "Engineering", "Product", "Data Science". null if not mentioned.\n'
            '8. job_location: City/region as stated. null if remote-only or not mentioned.\n'
            '9. salary_min / salary_max: Annual salary integers if stated (LPA in India, USD elsewhere). null if not mentioned.\n'
            '10. min_degree: "bachelor", "master", "phd", or "doctorate". null if not specified.\n'
            '11. preferred_majors: List of academic majors/branches (e.g. "Computer Science", "Electrical Engineering"). '
            'Empty [] if not specified.\n'
            '12. require_github: true ONLY if the JD explicitly asks for a GitHub profile/portfolio link.\n'
            '13. min_graduation_year / max_graduation_year: Integer year range for graduating cohorts '
            '(e.g. 2025 to 2027 for a July 2026 intake). null if not a cohort/fresher hire.\n\n'
            f"Job description:\n{sample}"
        )

        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=600,
        )

        content = (response.choices[0].message.content or "").strip()
        content = _re.sub(r"^```[a-z]*\n?", "", content)
        content = _re.sub(r"\n?```$", "", content).strip()

        json_match = _re.search(r"\{.*\}", content, _re.DOTALL)
        if not json_match:
            return {}

        data = _json.loads(json_match.group())

        # Normalise experience levels
        _LEVEL_SYNONYMS = {
            "intern": "junior", "interns": "junior", "internship": "junior",
            "fresher": "junior", "freshers": "junior",
            "entry": "junior", "entry-level": "junior", "entry level": "junior",
            "graduate": "junior", "junior": "junior",
            "mid": "mid", "mid-level": "mid", "mid level": "mid", "middle": "mid",
            "senior": "senior", "lead": "senior", "staff": "senior", "principal": "senior",
            "manager": "executive", "director": "executive", "vp": "executive",
            "executive": "executive", "c-level": "executive",
        }
        _VALID_LEVELS = {"junior", "mid", "senior", "executive"}
        normalized_levels: list = []
        for x in data.get("filter_experience_levels", []):
            mapped = _LEVEL_SYNONYMS.get(str(x).lower().strip(), str(x).lower().strip())
            if mapped in _VALID_LEVELS and mapped not in normalized_levels:
                normalized_levels.append(mapped)

        # Normalise work_type
        _WORK_TYPE_MAP = {
            "remote": "remote", "fully remote": "remote", "wfh": "remote",
            "onsite": "onsite", "on-site": "onsite", "in-office": "onsite", "office": "onsite",
            "hybrid": "hybrid",
        }
        raw_wt = str(data.get("work_type") or "").lower().strip()
        work_type = _WORK_TYPE_MAP.get(raw_wt) or (raw_wt if raw_wt in ("remote", "onsite", "hybrid") else None)

        # Normalise employment_type
        _EMP_TYPE_MAP = {
            "full_time": "full_time", "full time": "full_time", "fulltime": "full_time", "permanent": "full_time",
            "part_time": "part_time", "part time": "part_time", "parttime": "part_time",
            "contract": "contract", "freelance": "contract", "consultant": "contract",
            "internship": "internship", "intern": "internship", "apprenticeship": "internship",
        }
        raw_et = str(data.get("employment_type") or "").lower().strip()
        employment_type = _EMP_TYPE_MAP.get(raw_et)

        # Normalise degree
        _DEGREE_MAP = {
            "bachelor": "bachelor", "bachelor's": "bachelor", "be": "bachelor", "btech": "bachelor",
            "bsc": "bachelor", "ug": "bachelor", "undergraduate": "bachelor",
            "master": "master", "master's": "master", "mtech": "master", "msc": "master",
            "mba": "master", "pg": "master", "postgraduate": "master",
            "phd": "phd", "ph.d": "phd", "doctorate": "doctorate",
        }
        raw_deg = str(data.get("min_degree") or "").lower().strip()
        min_degree = _DEGREE_MAP.get(raw_deg)

        def _safe_int(v) -> Optional[int]:
            if v is None:
                return None
            try:
                return int(v)
            except (ValueError, TypeError):
                return None

        preferred_majors = [str(m) for m in data.get("preferred_majors", []) if m]

        return {
            "title": (str(data.get("title") or "").strip() or None),
            "min_experience": _safe_int(data.get("min_experience")) or 0,
            "max_experience": _safe_int(data.get("max_experience")),
            "filter_experience_levels": normalized_levels,
            "is_entry_level": bool(data.get("is_entry_level", False)),
            "work_type": work_type,
            "employment_type": employment_type,
            "department": (str(data.get("department") or "").strip() or None),
            "job_location": (str(data.get("job_location") or "").strip() or None),
            "salary_min": _safe_int(data.get("salary_min")),
            "salary_max": _safe_int(data.get("salary_max")),
            "min_degree": min_degree,
            "preferred_majors": preferred_majors,
            "require_github": bool(data.get("require_github", False)),
            "min_graduation_year": _safe_int(data.get("min_graduation_year")),
            "max_graduation_year": _safe_int(data.get("max_graduation_year")),
        }

    except Exception as exc:
        logger.error("LLM full-config extraction failed: %s", exc, exc_info=True)
        return {}


from fastapi import UploadFile, File
import os
import uuid
import tempfile
from app.services.parser import parse_document

@router.post("/extract-full-config-from-file", response_model=_JdFullConfigResponse)
async def extract_full_config_from_file(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> _JdFullConfigResponse:
    """Extract skills and job configuration from an uploaded JD file (PDF/DOCX)."""
    # Save uploaded file temporarily
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".pdf", ".docx", ".doc"}:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported.")
        
    temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
    os.close(temp_fd)
    
    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)
            
        parsed = parse_document(temp_path)
        text = parsed.text
        
        if not text or not text.strip():
            return _JdFullConfigResponse(skills=[], metadata=None)
            
        skills_task = _extract_skills_via_llm(text)
        metadata_task = _extract_jd_metadata_via_llm(text)
        
        skills = skills_task if skills_task else _classify_skills_by_section(text)
        metadata = metadata_task if metadata_task else _extract_jd_metadata_rule_based(text)
        
        return _JdFullConfigResponse(
            skills=[_JdSkillItem(**s) for s in skills] if isinstance(skills, list) else 
                   [_JdSkillItem(name=k, category="skill", is_required=v) for k, v in skills.items()],
            metadata=_JdMetadataResponse(
                title=metadata.get("title"),
                min_experience=metadata.get("min_experience", 0),
                max_experience=metadata.get("max_experience"),
                filter_experience_levels=metadata.get("filter_experience_levels", []),
                is_entry_level=metadata.get("is_entry_level", False)
            )
        )
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@router.post("/extract-full-config-from-jd", response_model=_JdFullConfigResponse)
def extract_full_config_from_jd(
    body: _JdMetadataRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> _JdFullConfigResponse:
    """Extract ALL job role configuration fields from JD text in a single LLM call.

    Returns everything needed to auto-fill the Edit Job Role form:
    title, experience, levels, work type, location, department, salary, degree,
    preferred majors, github requirement, and graduation year range.
    """
    text = body.text
    if not text or not text.strip():
        return _JdFullConfigResponse()

    extracted = _extract_full_config_via_llm(text)
    if not extracted:
        # Rule-based fallback covers the basic fields
        rb = _extract_jd_metadata_rule_based(text)
        extracted = rb

    return _JdFullConfigResponse(
        title=extracted.get("title"),
        min_experience=extracted.get("min_experience", 0),
        max_experience=extracted.get("max_experience"),
        filter_experience_levels=extracted.get("filter_experience_levels", []),
        is_entry_level=extracted.get("is_entry_level", False),
        work_type=extracted.get("work_type"),
        employment_type=extracted.get("employment_type"),
        department=extracted.get("department"),
        job_location=extracted.get("job_location"),
        salary_min=extracted.get("salary_min"),
        salary_max=extracted.get("salary_max"),
        min_degree=extracted.get("min_degree"),
        preferred_majors=extracted.get("preferred_majors", []),
        require_github=extracted.get("require_github", False),
        min_graduation_year=extracted.get("min_graduation_year"),
        max_graduation_year=extracted.get("max_graduation_year"),
    )


def _extract_jd_metadata_via_llm(text: str) -> dict:
    """Ask the configured LLM to extract role metadata from a JD text.

    Returns a dict with key "title", "min_experience", "filter_experience_levels", "is_entry_level".
    """
    try:
        from app.config import settings
        if not settings.llm_api_key:
            return {}
    except Exception:
        return {}

    try:
        import json as _json
        import re as _re
        from openai import OpenAI

        client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
            timeout=float(settings.llm_timeout),
        )

        sample = text[:6000]
        prompt = (
            "Analyze this job description and extract structural metadata. "
            "Return ONLY valid JSON with this exact schema:\n"
            '{\n'
            '  "title": "Software Engineer II",\n'
            '  "min_experience": 3,\n'
            '  "max_experience": null,\n'
            '  "filter_experience_levels": ["mid", "senior"],\n'
            '  "is_entry_level": false\n'
            '}\n\n'
            'Rules:\n'
            '1. "title": Best descriptive job role title extracted from the JD.\n'
            '2. "min_experience": Minimum years of experience explicitly requested (integer). Default to 0 for intern/fresher roles. '
            'If the JD gives a range like "3-8 years", set min_experience to the lower bound.\n'
            '2b. "max_experience": Integer years, upper bound of an experience range (e.g. "3-8 years" → 8). '
            'null if only a minimum is stated (e.g. "5+ years").\n'
            '3. "filter_experience_levels": Use ONLY values from ["junior", "mid", "senior", "executive"] (lowercase). '
            'For intern, fresher, graduate, or entry-level roles use ["junior"]. '
            'For lead/staff/principal roles use ["senior"]. '
            'For manager/director/VP/C-level roles use ["senior", "executive"]. '
            'Leave empty [] only when the JD targets all levels equally.\n'
            '4. "is_entry_level": true for internship, fresh graduate, entry-level, or fresher roles.\n\n'
            f"Job description:\n{sample}"
        )

        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=400,
        )

        content = (response.choices[0].message.content or "").strip()
        content = _re.sub(r"^```[a-z]*\n?", "", content)
        content = _re.sub(r"\n?```$", "", content).strip()

        json_match = _re.search(r"\{.*\}", content, _re.DOTALL)
        if not json_match:
            return {}

        data = _json.loads(json_match.group())

        # Normalise experience levels: lowercase + synonym mapping so the LLM
        # can return "Junior", "entry-level", "Intern" etc. and still match.
        _LEVEL_SYNONYMS = {
            "intern": "junior", "interns": "junior", "internship": "junior",
            "fresher": "junior", "freshers": "junior",
            "entry": "junior", "entry-level": "junior", "entry level": "junior",
            "graduate": "junior", "junior": "junior",
            "mid": "mid", "mid-level": "mid", "mid level": "mid", "middle": "mid",
            "senior": "senior", "lead": "senior", "staff": "senior", "principal": "senior",
            "manager": "executive", "director": "executive", "vp": "executive",
            "executive": "executive", "c-level": "executive",
        }
        _VALID_LEVELS = {"junior", "mid", "senior", "executive"}
        normalized_levels: list = []
        for x in data.get("filter_experience_levels", []):
            mapped = _LEVEL_SYNONYMS.get(str(x).lower().strip(), str(x).lower().strip())
            if mapped in _VALID_LEVELS and mapped not in normalized_levels:
                normalized_levels.append(mapped)

        title = data.get("title") or None
        if isinstance(title, str):
            title = title.strip() or None

        max_exp_raw = data.get("max_experience")
        max_experience = None
        if max_exp_raw is not None:
            try:
                max_experience = int(max_exp_raw)
            except (ValueError, TypeError):
                max_experience = None

        return {
            "title": title,
            "min_experience": int(data.get("min_experience", 0)),
            "max_experience": max_experience,
            "filter_experience_levels": normalized_levels,
            "is_entry_level": bool(data.get("is_entry_level", False)),
        }

    except Exception as exc:
        logger.error("LLM JD metadata extraction failed: %s", exc, exc_info=True)
        return {}


@router.post("/extract-metadata-from-jd", response_model=_JdMetadataResponse)
def extract_metadata_from_jd(
    body: _JdMetadataRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
) -> _JdMetadataResponse:
    """Extract job role metadata (title, experience level, min experience, entry status) from JD text."""
    text = body.text
    if not text or not text.strip():
        return _JdMetadataResponse()

    # Try LLM first; fall back to rule-based extraction when LLM is not configured or fails
    extracted = _extract_jd_metadata_via_llm(text)
    if not extracted:
        extracted = _extract_jd_metadata_rule_based(text)
        logger.debug("Metadata extracted via rule-based fallback: %s", extracted)

    return _JdMetadataResponse(
        title=extracted.get("title"),
        min_experience=extracted.get("min_experience", 0),
        max_experience=extracted.get("max_experience"),
        filter_experience_levels=extracted.get("filter_experience_levels", []),
        is_entry_level=extracted.get("is_entry_level", False)
    )
