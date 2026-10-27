from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    role: str = Field(
        default="recruiter",
        pattern="^(admin|recruiter)$",
    )


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    role: str
    created_at: datetime


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str
    email: str


class RefreshRequest(BaseModel):
    refresh_token: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=6)


class TokenData(BaseModel):
    user_id: Optional[int] = None
    email: Optional[str] = None
    role: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class UpdatePermissionsRequest(BaseModel):
    """Admin request to update fine-grained permission flags for a user."""
    can_export: Optional[bool] = None
    can_delete: Optional[bool] = None
    can_see_salary: Optional[bool] = None
    can_manage_jobs: Optional[bool] = None
    can_send_emails: Optional[bool] = None


# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------

class SkillBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = None


class SkillCreate(SkillBase):
    pass


class SkillOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: Optional[str] = None


# ---------------------------------------------------------------------------
# Job Roles
# ---------------------------------------------------------------------------

class ScoringWeights(BaseModel):
    projects: int = Field(default=45, ge=0, le=100)
    skills: int = Field(default=35, ge=0, le=100)
    education: int = Field(default=20, ge=0, le=100)


class JobRoleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    min_experience: int = Field(default=0, ge=0)
    max_experience: Optional[int] = Field(default=None, ge=0)
    weight_projects: int = Field(default=45, ge=0, le=100)
    weight_skills: int = Field(default=35, ge=0, le=100)
    weight_education: int = Field(default=20, ge=0, le=100)
    cosine_threshold: float = Field(default=0.70, ge=0.0, le=1.0)
    skill_ids: List[int] = Field(default_factory=list)
    skill_required_flags: Optional[List[bool]] = None   # parallel to skill_ids; True=required, False=nice-to-have
    # Auto-pause threshold settings
    shortlist_target: Optional[int] = Field(default=None, ge=1)
    min_fit_score: Optional[float] = Field(default=None, ge=0.0, le=100.0)
    # JD text and education filters
    description: Optional[str] = None
    min_degree: Optional[str] = Field(default=None, pattern="^(bachelor|master|phd|doctorate)?$")
    preferred_majors: List[str] = Field(default_factory=list)
    # Candidate pre-filter: which experience levels to include (empty = all)
    filter_experience_levels: List[str] = Field(default_factory=list)
    # Email controls: False suppresses auto-emails; admin can still send manually
    auto_email_enabled: bool = True
    # Hybrid pipeline Stage-1 threshold: 0.0 = disabled
    tfidf_threshold: Optional[float] = Field(default=0.0, ge=0.0, le=1.0)
    # Graduation year range filter: only evaluate candidates whose graduation year
    # falls within [min_graduation_year, max_graduation_year]. Either end can be None (unbounded).
    min_graduation_year: Optional[int] = Field(default=None, ge=1980, le=2040)
    max_graduation_year: Optional[int] = Field(default=None, ge=1980, le=2040)
    # When True, all candidates for this role receive fresher-friendly scoring:
    # design-verb project boost, no recency decay, flat global skill coverage.
    is_entry_level: bool = False
    # When True, GitHub presence is a required field. Missing github_url flags "Missed Requirement: GitHub".
    require_github: bool = False
    # Job listing display metadata
    work_type: Optional[str] = Field(default=None, pattern="^(remote|onsite|hybrid)?$")
    job_location: Optional[str] = None
    salary_min: Optional[int] = Field(default=None, ge=0)
    salary_max: Optional[int] = Field(default=None, ge=0)
    department: Optional[str] = None
    employment_type: Optional[str] = Field(default=None, pattern="^(full_time|part_time|contract|internship)?$")

    @model_validator(mode="after")
    def _weights_must_sum_to_100(self) -> "JobRoleCreate":
        total = self.weight_projects + self.weight_skills + self.weight_education
        if total != 100:
            raise ValueError(
                f"Scoring weights must sum to 100 (got {total}: "
                f"projects={self.weight_projects}, skills={self.weight_skills}, "
                f"education={self.weight_education})"
            )
        return self

    @model_validator(mode="after")
    def _max_experience_must_not_be_below_min(self) -> "JobRoleCreate":
        if self.max_experience is not None and self.max_experience < self.min_experience:
            raise ValueError(
                f"max_experience ({self.max_experience}) cannot be less than "
                f"min_experience ({self.min_experience})"
            )
        return self


class JobRoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    min_experience: int
    max_experience: Optional[int] = None
    weight_projects: int
    weight_skills: int
    weight_education: int
    cosine_threshold: float
    intake_paused: bool = False
    shortlist_target: Optional[int] = None
    min_fit_score: Optional[float] = None
    created_at: datetime
    requirements: List["JobRoleRequirementOut"] = Field(default_factory=list)
    questions: List["JobRoleQuestionOut"] = Field(default_factory=list)
    # JD text and education filters
    description: Optional[str] = None
    min_degree: Optional[str] = None
    preferred_majors: List[str] = Field(default_factory=list)
    filter_experience_levels: List[str] = Field(default_factory=list)
    auto_email_enabled: bool = True
    tfidf_threshold: Optional[float] = None
    min_graduation_year: Optional[int] = None
    max_graduation_year: Optional[int] = None
    is_entry_level: bool = False
    require_github: bool = False
    # Job listing display metadata
    work_type: Optional[str] = None
    job_location: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    department: Optional[str] = None
    employment_type: Optional[str] = None
    is_archived: bool = False
    # Skill names (read-only, populated from job_role_skills relation)
    skill_names: List[str] = Field(default_factory=list)
    skill_ids: List[int] = Field(default_factory=list)
    skill_required_flags: List[bool] = Field(default_factory=list)

    @field_validator("filter_experience_levels", mode="before")
    @classmethod
    def _coerce_exp_levels(cls, v: object) -> List[str]:
        if isinstance(v, str):
            return [s.strip() for s in v.split(",") if s.strip()]
        if v is None:
            return []
        return list(v)  # type: ignore[arg-type]

    @field_validator("preferred_majors", mode="before")
    @classmethod
    def _coerce_majors(cls, v: object) -> List[str]:
        if isinstance(v, str):
            import json as _json
            try:
                parsed = _json.loads(v)
                if isinstance(parsed, list):
                    return [str(x) for x in parsed]
            except _json.JSONDecodeError:
                return [s.strip() for s in v.split(",") if s.strip()]
        if v is None:
            return []
        return list(v)  # type: ignore[arg-type]


class IntakePauseRequest(BaseModel):
    paused: bool


class ArchiveRequest(BaseModel):
    archived: bool


# ---------------------------------------------------------------------------
# Job Role Requirements
# ---------------------------------------------------------------------------

class JobRoleRequirementCreate(BaseModel):
    label: str = Field(..., min_length=1, max_length=255)
    weight: float = Field(..., ge=0.0, le=100.0)
    req_type: str = Field(default="skill", pattern="^(skill|experience|education|other)$")
    description: Optional[str] = None
    min_years: Optional[int] = Field(default=None, ge=0, le=50)


class JobRoleRequirementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    weight: float
    req_type: str
    description: Optional[str] = None
    min_years: Optional[int] = None


class RequirementBulkUpdate(BaseModel):
    """Replace all requirements for a job role in one request."""
    requirements: List[JobRoleRequirementCreate]

    @field_validator("requirements")
    @classmethod
    def weights_must_sum_100(cls, v: List[JobRoleRequirementCreate]) -> List[JobRoleRequirementCreate]:
        if v:
            total = sum(r.weight for r in v)
            if abs(total - 100.0) > 0.5:
                raise ValueError(f"Requirement weights must sum to 100, got {total:.1f}")
        return v


class JobRoleQuestionCreate(BaseModel):
    question_text: str = Field(..., min_length=1, max_length=1000)
    question_type: str = Field(default="yes_no", pattern="^(yes_no|text)$")
    is_required: bool = True
    # Only meaningful for yes_no questions: "yes" or "no" — matching this answer
    # auto-flags the application as knocked out.
    knockout_reject_on: Optional[str] = Field(default=None, pattern="^(yes|no)?$")
    order: int = 0


class JobRoleQuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_text: str
    question_type: str
    is_required: bool
    knockout_reject_on: Optional[str] = None
    order: int = 0


class QuestionsBulkUpdate(BaseModel):
    """Replace all screening questions for a job role in one request."""
    questions: List[JobRoleQuestionCreate]


# ---------------------------------------------------------------------------
# Upload / Resume
# ---------------------------------------------------------------------------

class UploadResponse(BaseModel):
    resume_id: int
    candidate_id: int
    duplicate_status: str   # "unique" | "duplicate" | "near_duplicate"
    sections_detected: List[str]
    candidate_name: str
    candidate_email: Optional[str] = None
    # Extended candidate profile — populated when listing stored resumes
    candidate_phone: Optional[str] = None
    candidate_current_title: Optional[str] = None
    candidate_experience_level: Optional[str] = None
    candidate_years_experience: Optional[float] = None
    candidate_graduation_year: Optional[int] = None
    candidate_location: Optional[str] = None


class ResumeVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    candidate_id: int
    filename: str
    simhash: Optional[str] = None
    uploaded_at: datetime
    is_current: bool


class ResumeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parsed_at: datetime
    sections: Optional[str] = None   # raw JSON text


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: Optional[str] = None


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

class EvaluateRequest(BaseModel):
    job_role_id: int
    resume_ids: List[int] = Field(default_factory=list)
    weights: Optional[ScoringWeights] = None


# Alias kept for internal router use
EvaluationRequest = EvaluateRequest


class BulkRerunRequest(BaseModel):
    job_role_id: int


class SkillMatchDetail(BaseModel):
    skill_name: str
    score: float
    confidence: float
    best_section: str
    excerpt: Optional[str] = None

    # Accept both camelCase aliases coming from stored JSON
    model_config = ConfigDict(populate_by_name=True)


class EvaluateResponse(BaseModel):
    job_id: str
    queued_count: int


# Alias kept for internal router use
EvaluationResponse = EvaluateResponse


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    resume_id: int
    job_role_id: int
    total_score: float
    project_score: float
    skill_score: float
    education_score: float
    experience_score: float = 0.0
    evaluated_at: datetime


class RequirementBreakdown(BaseModel):
    """Per-requirement score entry stored on Evaluation.requirements_breakdown."""
    requirement_id: int
    label: str
    req_type: str
    weight: float
    score: float           # 0-100
    evidence: Optional[str] = None   # excerpt or evidence text


class ScreeningAnswerOut(BaseModel):
    question_id: int
    question_text: str
    answer: str
    is_knockout: bool = False


class EvaluationDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    resume_id: int
    candidate_id: int = 0   # populated manually — Evaluation has no candidate_id column
    candidate_name: str = ""
    candidate_email: Optional[str] = None
    job_role_id: int
    job_role_title: str
    total_score: float
    project_score: float
    skill_score: float
    education_score: float
    experience_score: float = 0.0
    evaluated_at: datetime
    skills_matched: List[SkillMatchDetail] = Field(default_factory=list)
    skill_gaps: List[str] = Field(default_factory=list)
    excerpts: List[str] = Field(default_factory=list)
    resume_text: Optional[str] = None
    resume_sections: List[Dict] = Field(default_factory=list)
    status: Optional[str] = None
    shortlist_status: Optional[str] = None   # alias for status, for frontend compatibility
    notes: Optional[str] = None              # note from latest shortlist action
    confidence_tiers: Dict[str, List[str]] = Field(default_factory=dict)
    requirements_breakdown: List[RequirementBreakdown] = Field(default_factory=list)
    reasoning_summary: Optional[str] = None
    interview_questions: List[str] = Field(default_factory=list)
    email_sent_at: Optional[datetime] = None
    email_opened_at: Optional[datetime] = None
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    tfidf_score: Optional[float] = None
    cover_letter: Optional[str] = None
    screening_answers: List[ScreeningAnswerOut] = Field(default_factory=list)
    knockout_failed: bool = False
    tags: List[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Results (paginated list view)
# ---------------------------------------------------------------------------

class ResultsResponse(BaseModel):
    evaluation_id: int
    candidate_id: int
    candidate_name: str
    candidate_email: Optional[str] = None
    candidate_phone: Optional[str] = None
    candidate_current_title: Optional[str] = None
    candidate_experience_level: Optional[str] = None
    candidate_years_experience: Optional[float] = None
    candidate_graduation_year: Optional[int] = None
    resume_id: int
    total_score: float
    project_score: float
    skill_score: float
    education_score: float
    experience_score: float = 0.0
    skills_matched: int
    skills_total: int
    project_match_score: float
    project_match_label: str
    status: Optional[str] = None   # latest shortlist status
    rank: Optional[int] = None
    needs_manual_review: bool = False
    evaluated_at: datetime
    email_sent_at: Optional[datetime] = None
    email_opened_at: Optional[datetime] = None
    job_role_id: int = 0
    job_role_title: str = ""
    matched_skill_names: List[str] = Field(default_factory=list)
    candidate_stage: str = "applied"
    # Hybrid pipeline fields
    tfidf_score: Optional[float] = None          # Stage-1 TF-IDF cosine similarity
    filter_stage: str = "llm_scored"             # "llm_scored" | "tfidf_filtered"
    github_skill_gap_severity: Optional[str] = None  # "high" | "medium" | None
    missed_requirements: List[str] = Field(default_factory=list)  # e.g. ["GitHub"]
    github_url: Optional[str] = None
    candidate_location: Optional[str] = None


class PaginatedResults(BaseModel):
    items: List[ResultsResponse]
    total: int
    page: int
    limit: int
    pages: int


class BulkActionRequest(BaseModel):
    resume_ids: List[int] = Field(..., max_length=500)


# ---------------------------------------------------------------------------
# ZIP Batch Upload
# ---------------------------------------------------------------------------

class ZipUploadItem(BaseModel):
    filename: str
    status: str   # "parsed" | "duplicate" | "near_duplicate" | "error"
    candidate_id: Optional[int] = None
    candidate_name: Optional[str] = None
    error: Optional[str] = None


class ZipUploadResponse(BaseModel):
    total_files: int
    parsed_count: int
    duplicate_count: int
    error_count: int
    skipped_count: int   # non-PDF/DOCX/hidden files ignored during extraction
    items: List[ZipUploadItem]


# ---------------------------------------------------------------------------
# Semantic Search
# ---------------------------------------------------------------------------

class SemanticSearchRequest(BaseModel):
    query: str = Field(..., min_length=2, max_length=1000)
    limit: int = Field(default=20, ge=1, le=100)


class SemanticSearchHit(BaseModel):
    candidate_id: int
    name: str
    email: Optional[str] = None
    current_title: Optional[str] = None
    experience_level: Optional[str] = None
    location: Optional[str] = None
    similarity: float
    snippet: str
    latest_evaluation_id: Optional[int] = None


# ---------------------------------------------------------------------------
# Emails
# ---------------------------------------------------------------------------

class ManualEmailRequest(BaseModel):
    subject: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)


class SendNextStepsRequest(BaseModel):
    """Used by admin to manually trigger the next-steps email for a candidate."""
    force: bool = False   # if True, send even if email_sent_at is already set


class RejectionEmailRequest(BaseModel):
    note: Optional[str] = None   # optional personalised message to include

# ---------------------------------------------------------------------------
# Shortlist
# ---------------------------------------------------------------------------

class ShortlistRequest(BaseModel):
    evaluation_id: int
    status: str = Field(..., pattern="^(shortlisted|review|rejected)$")
    note: Optional[str] = None


class BulkShortlistRequest(BaseModel):
    evaluation_ids: List[int] = Field(..., min_length=1)
    status: str = Field(..., pattern="^(shortlisted|review|rejected)$")
    note: Optional[str] = None


class ShortlistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    evaluation_id: int
    status: str
    note: Optional[str] = None
    changed_at: datetime


# ---------------------------------------------------------------------------
# Outcomes
# ---------------------------------------------------------------------------

class OutcomeRequest(BaseModel):
    candidate_id: int
    outcome: str = Field(..., pattern="^(hired|rejected|withdrew)$")


class OutcomeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    candidate_id: int
    outcome: str
    recorded_at: datetime


# ---------------------------------------------------------------------------
# Candidate Stage
# ---------------------------------------------------------------------------

_VALID_STAGES = {"applied", "screening", "coding", "interview", "offer", "hired", "rejected"}

class UpdateCandidateStageRequest(BaseModel):
    stage: str = Field(..., pattern="^(applied|screening|coding|interview|offer|hired|rejected)$")


# ---------------------------------------------------------------------------
# Auth — Forgot Password
# ---------------------------------------------------------------------------

class ForgotPasswordRequest(BaseModel):
    email: EmailStr


# ---------------------------------------------------------------------------
# Email Templates
# ---------------------------------------------------------------------------

class AttachmentOut(BaseModel):
    id: int
    filename: str
    content_type: str
    file_size: int
    uploaded_at: datetime


class EmailTemplateOut(BaseModel):
    key: str
    subject: str
    body_text: str
    updated_at: Optional[datetime] = None
    # Meeting link CTA
    meeting_link: Optional[str] = None
    meeting_cta_label: Optional[str] = "Join Meeting"
    generate_qr: bool = False
    # CC / BCC (comma-separated) always applied when this template is sent
    cc: Optional[str] = None
    bcc: Optional[str] = None
    # Attached documents (metadata only — file_data excluded for list API)
    attachments: List[AttachmentOut] = []


class EmailTemplateUpdate(BaseModel):
    subject: str = Field(..., min_length=1, max_length=500)
    body_text: str = Field(..., min_length=1)
    # Meeting link CTA (optional)
    meeting_link: Optional[str] = Field(default=None, max_length=2048)
    meeting_cta_label: Optional[str] = Field(default="Join Meeting", max_length=128)
    generate_qr: bool = False
    # CC / BCC (comma-separated)
    cc: Optional[str] = Field(default=None, max_length=2048)
    bcc: Optional[str] = Field(default=None, max_length=2048)


# ---------------------------------------------------------------------------
# Manual Evaluation
# ---------------------------------------------------------------------------

class ManualEvaluationCreate(BaseModel):
    manual_score: float = Field(..., ge=0.0, le=100.0)
    justification: Optional[str] = None
    skills_checklist: Optional[dict] = None  # {skill_name: bool}


class ManualEvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    evaluation_id: int
    recruiter_id: Optional[int] = None
    manual_score: float
    justification: Optional[str] = None
    skills_checklist: Optional[dict] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
