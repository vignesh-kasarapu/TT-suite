from datetime import datetime, timezone


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import backref, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    # TT Suite: people sign in at the portal; this links the row to the suite person (app.users.id).
    suite_user_id = Column(String(40), unique=True, nullable=True)
    name = Column(String(255), nullable=True)
    hashed_password = Column(String(255), nullable=True)  # unused under the suite (no logins here)
    role = Column(String(50), nullable=False, default="recruiter")  # "admin" | "recruiter" (set by the suite)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    # JSON dict of fine-grained permission flags: {"can_export": true, "can_delete": false, ...}
    permissions = Column(Text, nullable=True)

    # Relationships
    job_roles = relationship(
        "JobRole",
        back_populates="creator",
        foreign_keys="JobRole.created_by",
    )
    shortlists = relationship(
        "Shortlist",
        back_populates="changer",
        foreign_keys="Shortlist.changed_by",
    )
    outcomes = relationship(
        "Outcome",
        back_populates="recorder",
        foreign_keys="Outcome.recorded_by",
    )
    audit_logs = relationship("AuditLog", back_populates="user")


class Candidate(Base):
    __tablename__ = "candidates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    # Nullable FK to resume_versions; use_alter + post_update avoids circular dependency
    current_version_id = Column(
        Integer,
        ForeignKey("resume_versions.id", use_alter=True, ondelete="SET NULL"),
        nullable=True,
    )
    # External profile links (extracted from resume/email)
    linkedin_url = Column(String(500), nullable=True)
    github_url = Column(String(500), nullable=True)
    portfolio_url = Column(String(500), nullable=True)
    # Parsed profile fields (extracted during resume processing)
    current_title = Column(String(200), nullable=True)     # most recent job title
    experience_level = Column(String(20), nullable=True)   # junior | mid | senior | executive
    years_experience = Column(Float, nullable=True)        # calculated from date ranges
    graduation_year = Column(Integer, nullable=True)        # most recent education end year
    # Enrichment data (JSON blobs)
    linkedin_data = Column(Text, nullable=True)       # JSON: enriched LinkedIn profile
    github_summary = Column(Text, nullable=True)      # JSON: github_summary object
    consistency_flags = Column(Text, nullable=True)   # JSON: list of consistency_flag objects
    enrichment_sources = Column(Text, nullable=True)  # JSON: list of source names used
    portfolio_summary = Column(Text, nullable=True)    # JSON: portfolio analysis result
    project_analysis = Column(Text, nullable=True)     # JSON: on-demand deep project analysis result
    needs_manual_review = Column(Boolean, nullable=False, default=False)
    # Intake channel: upload | email | csv | manual
    source = Column(String(32), nullable=True)
    # Hiring pipeline stage — DEPRECATED as the source of truth: this is now a
    # derived "last-moved" convenience column, dual-written whenever the
    # authoritative per-application Evaluation.stage changes. A candidate with
    # multiple applications has independent stages per Evaluation; this column
    # only reflects whichever one was most recently updated. Kept for the
    # non-job-scoped read sites (global candidate list/detail views).
    stage = Column(String(32), nullable=False, default="applied")  # applied|screening|coding|interview|offer|hired|rejected
    # Soft delete — set to non-null to hide the candidate without losing history
    deleted_at = Column(DateTime, nullable=True, default=None)
    # GDPR consent — captured at intake time (upload or portal apply)
    consent_given_at = Column(DateTime, nullable=True)
    consent_ip = Column(String(45), nullable=True)          # IPv4 or IPv6
    consent_version = Column(String(20), nullable=True)     # Privacy policy version, e.g. "2025-01"

    # Portal linkage & candidate details
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    location = Column(String(255), nullable=True)
    pan_card = Column(String(50), nullable=True)
    manual_skills = Column(Text, nullable=True)   # legacy — kept for migration safety
    primary_skills = Column(Text, nullable=True)   # JSON-serialized list[str] — core technologies
    secondary_skills = Column(Text, nullable=True) # JSON-serialized list[str] — supporting tools
    tags = Column(Text, nullable=True)             # JSON-serialized list[str] — recruiter labels
    portal_registered = Column(Boolean, nullable=False, default=False)

    # EEO self-identification — entirely voluntary, never used in scoring/evaluation.
    # Null/omitted is treated the same as "prefer not to say".
    gender_identity = Column(String(50), nullable=True)
    ethnicity = Column(String(50), nullable=True)
    veteran_status = Column(String(50), nullable=True)
    disability_status = Column(String(50), nullable=True)

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    resume_versions = relationship(
        "ResumeVersion",
        back_populates="candidate",
        foreign_keys="ResumeVersion.candidate_id",
    )
    current_version = relationship(
        "ResumeVersion",
        foreign_keys=[current_version_id],
        post_update=True,
    )
    outcomes = relationship("Outcome", back_populates="candidate")


class ResumeVersion(Base):
    __tablename__ = "resume_versions"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    simhash = Column(String(64), nullable=True)
    uploaded_at = Column(DateTime, nullable=False, default=_utcnow)
    is_current = Column(Boolean, nullable=False, default=True)

    __table_args__ = (
        Index("ix_resume_versions_simhash", "simhash"),
    )

    # Relationships
    candidate = relationship(
        "Candidate",
        back_populates="resume_versions",
        foreign_keys=[candidate_id],
    )
    resume = relationship("Resume", back_populates="version", uselist=False)


class Resume(Base):
    """Parsed content for a resume version.  id == resume_version_id (1-to-1)."""

    __tablename__ = "resumes"

    id = Column(
        Integer,
        ForeignKey("resume_versions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    raw_text = Column(Text, nullable=True)
    sections = Column(Text, nullable=True)   # JSON-serialised list[Section]
    parsed_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    version = relationship("ResumeVersion", back_populates="resume")
    evaluations = relationship("Evaluation", back_populates="resume")


class JobRoleRequirement(Base):
    """Per-requirement weight entry for a job role (flexible alternative to fixed 3-weights)."""
    __tablename__ = "job_role_requirements"

    id = Column(Integer, primary_key=True, index=True)
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label = Column(String(255), nullable=False)       # e.g. "5+ years Python"
    weight = Column(Float, nullable=False)             # 0-100; all for a role should sum to 100
    req_type = Column(String(50), nullable=False, default="skill")  # skill|experience|education|other
    description = Column(Text, nullable=True)          # optional freeform detail
    min_years = Column(Integer, nullable=True)         # minimum years required (experience type)

    job_role = relationship("JobRole", back_populates="requirements")


class JobRoleQuestion(Base):
    """Custom screening/knockout question a candidate answers when applying to a role."""
    __tablename__ = "job_role_questions"

    id = Column(Integer, primary_key=True, index=True)
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question_text = Column(Text, nullable=False)
    question_type = Column(String(10), nullable=False, default="yes_no")  # yes_no|text
    is_required = Column(Boolean, nullable=False, default=True)
    # For yes_no questions only: if the candidate's answer matches this value
    # (case-insensitive "yes"/"no"), the application is auto-flagged as knocked out.
    knockout_reject_on = Column(String(10), nullable=True)
    order = Column(Integer, nullable=False, default=0)

    job_role = relationship("JobRole", back_populates="screening_questions")


class JobRole(Base):
    __tablename__ = "job_roles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    min_experience = Column(Integer, nullable=True, default=0)
    max_experience = Column(Integer, nullable=True, default=None)
    weight_projects = Column(Integer, nullable=False, default=50)
    weight_skills = Column(Integer, nullable=False, default=30)
    weight_education = Column(Integer, nullable=False, default=20)
    cosine_threshold = Column(Float, nullable=False, default=0.70)
    description = Column(Text, nullable=True)          # full job description text
    min_degree = Column(String(50), nullable=True)     # bachelor | master | phd
    preferred_majors = Column(Text, nullable=True)     # JSON list[str]
    created_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    # Candidate pre-filter: comma-separated experience levels (e.g. "mid,senior")
    # Empty/null means accept all levels.
    filter_experience_levels = Column(String(100), nullable=True)
    # Auto-pause threshold settings
    intake_paused = Column(Boolean, nullable=False, default=False)
    shortlist_target = Column(Integer, nullable=True)
    min_fit_score = Column(Float, nullable=True)
    # Email controls: when False, auto-emails are suppressed; admin can still send manually
    auto_email_enabled = Column(Boolean, nullable=False, default=True)
    # Hybrid pipeline Stage-1: minimum TF-IDF cosine similarity to pass to LLM.
    # 0.0 (default) = disabled — every resume goes to the LLM scorer.
    tfidf_threshold = Column(Float, nullable=True, default=0.0)
    # Fresher/recency filter: evaluate only candidates whose graduation year falls within
    # [min_graduation_year, max_graduation_year]. Null on either end means unbounded.
    min_graduation_year = Column(Integer, nullable=True)
    max_graduation_year = Column(Integer, nullable=True)
    # When True, all candidates for this role are scored with fresher-friendly rules:
    # design-verb project boost (+15%), no recency decay, global skill coverage.
    is_entry_level = Column(Boolean, nullable=False, default=False)
    # When True, GitHub profile link is treated as a top-level required field.
    # Candidates missing a github_url are flagged with "Missed Requirement: GitHub".
    require_github = Column(Boolean, nullable=False, default=False)
    # Optional hard deadline — intake auto-pauses at this UTC datetime if set
    closes_at = Column(DateTime, nullable=True)
    # Job listing metadata (shown on public portal)
    work_type = Column(String(50), nullable=True)       # remote | onsite | hybrid
    job_location = Column(String(255), nullable=True)   # e.g. "Bangalore, India"
    salary_min = Column(Integer, nullable=True)         # annual, in local currency units (thousands)
    salary_max = Column(Integer, nullable=True)
    department = Column(String(100), nullable=True)     # e.g. "Engineering"
    employment_type = Column(String(50), nullable=True) # full_time | part_time | contract | internship
    # Soft-delete: archived roles are hidden from the candidate portal but keep
    # their evaluations/candidates intact (unlike DELETE, which cascades).
    is_archived = Column(Boolean, nullable=False, default=False)

    # Relationships
    creator = relationship("User", back_populates="job_roles", foreign_keys=[created_by])
    job_role_skills = relationship(
        "JobRoleSkill",
        back_populates="job_role",
        cascade="all, delete-orphan",
    )
    requirements = relationship(
        "JobRoleRequirement",
        back_populates="job_role",
        cascade="all, delete-orphan",
        order_by="JobRoleRequirement.id",
    )
    screening_questions = relationship(
        "JobRoleQuestion",
        back_populates="job_role",
        cascade="all, delete-orphan",
        order_by="JobRoleQuestion.order",
    )
    evaluations = relationship(
        "Evaluation",
        back_populates="job_role",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class Skill(Base):
    __tablename__ = "skills"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    category = Column(String(100), nullable=True)
    embedding = Column(Text, nullable=True)   # JSON-serialised list[float]

    # Relationships
    job_role_skills = relationship(
        "JobRoleSkill",
        back_populates="skill",
        cascade="all, delete-orphan",
    )


class JobRoleSkill(Base):
    __tablename__ = "job_role_skills"

    id = Column(Integer, primary_key=True, index=True)
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    skill_id = Column(
        Integer,
        ForeignKey("skills.id", ondelete="CASCADE"),
        nullable=False,
    )
    is_keyword = Column(Boolean, nullable=False, default=False)
    is_required = Column(Boolean, nullable=False, default=True)

    # Relationships
    job_role = relationship("JobRole", back_populates="job_role_skills")
    skill = relationship("Skill", back_populates="job_role_skills")


class CandidateSavedJob(Base):
    """Bookmarked job roles for a candidate portal user (many-to-many)."""
    __tablename__ = "candidate_saved_jobs"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    __table_args__ = (
        UniqueConstraint("candidate_id", "job_role_id", name="uq_saved_job_candidate_role"),
    )

    candidate = relationship("Candidate")
    job_role = relationship("JobRole")


class Evaluation(Base):
    __tablename__ = "evaluations"

    id = Column(Integer, primary_key=True, index=True)
    resume_id = Column(
        Integer,
        ForeignKey("resumes.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    total_score = Column(Float, nullable=False, default=0.0)
    project_score = Column(Float, nullable=False, default=0.0)
    skill_score = Column(Float, nullable=False, default=0.0)
    education_score = Column(Float, nullable=False, default=0.0)
    experience_score = Column(Float, nullable=False, default=0.0)
    skills_matched = Column(Text, nullable=True)          # JSON list[SkillMatchDetail]
    excerpts = Column(Text, nullable=True)                 # JSON list[str]
    requirements_breakdown = Column(Text, nullable=True)   # JSON list[RequirementScore] when req-mode
    reasoning_summary = Column(Text, nullable=True)        # AI-generated or rule-based fit summary
    evaluated_at = Column(DateTime, nullable=False, default=_utcnow)
    # None = scored normally; "queued" = held because intake was paused
    eval_status = Column(String(20), nullable=True, default=None)
    # Set when a next-steps email has been sent to this candidate for this evaluation
    email_sent_at = Column(DateTime, nullable=True, default=None)
    # Set when the candidate opens the email (1×1 tracking pixel hit)
    email_opened_at = Column(DateTime, nullable=True, default=None)
    # Opaque token used to identify the evaluation in tracking pixel requests
    email_tracking_token = Column(String(64), nullable=True, unique=True, index=True)
    # Stage-1 TF-IDF cosine similarity score (0-1). Stored for every evaluation
    # so the UI can surface it regardless of whether the pre-filter fired.
    tfidf_score = Column(Float, nullable=True)
    # AI-generated interview prep questions (JSON list[str])
    interview_questions = Column(Text, nullable=True)
    # Interview scheduling
    interview_scheduled_at = Column(DateTime, nullable=True)
    interview_link = Column(String(500), nullable=True)  # Zoom/Meet/Teams URL
    # Per-application hiring pipeline stage — authoritative (see Candidate.stage
    # for why that column is now just a derived cache of this one).
    stage = Column(String(32), nullable=False, default="applied")  # applied|screening|coding|interview|offer|hired|rejected|withdrawn
    # Provenance: which model/prompt produced this score, so scores stay auditable
    # and comparable across LLM_MODEL swaps (see app.services.llm_scorer).
    llm_model = Column(String(120), nullable=True)
    llm_provider = Column(String(30), nullable=True)
    prompt_version = Column(String(30), nullable=True)
    scoring_method = Column(String(10), nullable=True)   # "llm" or "tfidf"
    # True when the embedding cross-check disagreed with the LLM's tier claim
    # on at least one skill — surface for manual review.
    flagged_for_review = Column(Boolean, nullable=False, default=False)
    # Candidate-submitted cover letter for this specific application
    cover_letter = Column(Text, nullable=True)
    # Candidate's answers to the job role's screening questions (JSON list[ScreeningAnswer])
    screening_answers = Column(Text, nullable=True)
    # True when at least one answer matched a question's knockout_reject_on value
    knockout_failed = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint("job_role_id", "resume_id", name="uq_eval_job_resume"),
        Index("ix_evaluations_total_score", "total_score"),
    )

    # Relationships
    resume = relationship("Resume", back_populates="evaluations")
    job_role = relationship("JobRole", back_populates="evaluations")
    shortlists = relationship(
        "Shortlist",
        back_populates="evaluation",
        cascade="all, delete-orphan",
    )


class Shortlist(Base):
    __tablename__ = "shortlists"

    id = Column(Integer, primary_key=True, index=True)
    evaluation_id = Column(
        Integer,
        ForeignKey("evaluations.id", ondelete="CASCADE"),
        nullable=False,
    )
    status = Column(String(50), nullable=False, default="review")  # shortlisted | review | rejected
    note = Column(Text, nullable=True)
    changed_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    changed_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    evaluation = relationship("Evaluation", back_populates="shortlists")
    changer = relationship("User", back_populates="shortlists", foreign_keys=[changed_by])


class Outcome(Base):
    __tablename__ = "outcomes"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
    )
    outcome = Column(String(50), nullable=False)   # hired | rejected | withdrew
    recorded_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    recorded_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    candidate = relationship("Candidate", back_populates="outcomes")
    recorder = relationship("User", back_populates="outcomes", foreign_keys=[recorded_by])


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    action = Column(String(255), nullable=False)   # e.g. "update", "delete", "restore", "stage_change"
    target_type = Column(String(100), nullable=True)  # "candidate" | "evaluation"
    target_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)          # JSON: {field: [old, new], ...}
    timestamp = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    user = relationship("User", back_populates="audit_logs")


class EmailTemplate(Base):
    """Admin-editable email templates. subject/body_text override hardcoded defaults."""
    __tablename__ = "email_templates"

    key = Column(String(64), primary_key=True)
    subject = Column(Text, nullable=False)
    body_text = Column(Text, nullable=False)
    updated_at = Column(DateTime, nullable=True, default=_utcnow)
    # Meeting / video link embedded as a branded CTA button
    meeting_link = Column(Text, nullable=True)
    meeting_cta_label = Column(String(128), nullable=True, default="Join Meeting")
    # When True, a QR code PNG is generated from meeting_link and embedded in the email
    generate_qr = Column(Boolean, nullable=False, default=False)
    # Comma-separated email addresses always CC'd / BCC'd when this template is sent
    cc = Column(Text, nullable=True)
    bcc = Column(Text, nullable=True)

    attachments = relationship("EmailTemplateAttachment", back_populates="template", cascade="all, delete-orphan")


class EmailTemplateAttachment(Base):
    """Binary document (offer letter, NDA, etc.) uploaded by admin and attached when sending a template."""
    __tablename__ = "email_template_attachments"

    id = Column(Integer, primary_key=True, index=True)
    template_key = Column(
        String(64),
        ForeignKey("email_templates.key", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename = Column(Text, nullable=False)
    content_type = Column(String(128), nullable=False)
    file_data = Column(LargeBinary, nullable=False)
    file_size = Column(Integer, nullable=False, default=0)  # bytes
    uploaded_at = Column(DateTime, nullable=False, default=_utcnow)

    template = relationship("EmailTemplate", back_populates="attachments")


class OrgEmployee(Base):
    """Employee synced from Azure AD or LDAP — used for CC/BCC autocomplete."""
    __tablename__ = "org_employees"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    display_name = Column(String(255), nullable=True)
    job_title = Column(String(255), nullable=True)
    department = Column(String(255), nullable=True)
    source = Column(String(32), nullable=False, default="manual")  # "azure_ad" | "ldap"
    synced_at = Column(DateTime, nullable=True)


class SystemSetting(Base):
    """Key-value store for admin-configurable system settings (e.g. IMAP credentials)."""
    __tablename__ = "system_settings"

    key = Column(String(128), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=True, default=_utcnow)


class InboundEmail(Base):
    """Tracks emails received by the ingestion pipeline."""

    __tablename__ = "inbound_emails"

    id = Column(Integer, primary_key=True, index=True)
    message_id = Column(String(500), unique=True, nullable=False)  # IMAP message-id header
    sender_email = Column(String(255), nullable=True)
    subject = Column(String(500), nullable=True)
    received_at = Column(DateTime, nullable=False, default=_utcnow)
    job_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status = Column(String(50), nullable=False, default="new")  # new | processed | failed | no_attachment
    raw_file_paths = Column(Text, nullable=True)  # JSON list of saved attachment paths
    error_message = Column(Text, nullable=True)


class InterviewFeedback(Base):
    """Structured feedback submitted by interviewers after each interview stage."""

    __tablename__ = "interview_feedback"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    evaluation_id = Column(
        Integer,
        ForeignKey("evaluations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    interviewer_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    stage = Column(String(32), nullable=False)          # screening | coding | interview
    rating = Column(Integer, nullable=False)             # 1–5 overall
    technical_score = Column(Float, nullable=True)       # 0–10
    communication_score = Column(Float, nullable=True)   # 0–10
    culture_fit_score = Column(Float, nullable=True)     # 0–10
    recommendation = Column(String(32), nullable=True)   # strong_hire | hire | no_hire | strong_no_hire
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    # Relationships
    candidate = relationship("Candidate")
    evaluation = relationship("Evaluation")
    interviewer = relationship("User")


class ShareLink(Base):
    """Token-gated read-only share link sent to hiring managers / external clients."""
    __tablename__ = "share_links"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), unique=True, nullable=False, index=True)
    job_role_id = Column(
        Integer,
        ForeignKey("job_roles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # JSON list of evaluation_ids to expose; null = all evaluated for the job role
    evaluation_ids = Column(Text, nullable=True)
    # JSON list of candidate stages to filter by (optional); null = all stages
    stages = Column(Text, nullable=True)
    # Optional branding / recipient info
    recipient_name = Column(String(255), nullable=True)
    label = Column(String(255), nullable=True)          # e.g. "CTO Review — June 2026"
    created_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    expires_at = Column(DateTime, nullable=True)        # null = never expires
    # JSON list of {evaluation_id, voter_token, vote} objects
    votes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    job_role = relationship("JobRole")
    creator = relationship("User", foreign_keys=[created_by])


class CandidateComment(Base):
    """Team collaboration: threaded comments on a candidate visible to all recruiters."""

    __tablename__ = "candidate_comments"

    id = Column(Integer, primary_key=True, index=True)
    candidate_id = Column(
        Integer,
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    parent_id = Column(
        Integer,
        ForeignKey("candidate_comments.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=True)

    candidate = relationship("Candidate")
    author = relationship("User")
    replies = relationship(
        "CandidateComment",
        backref=backref("parent", remote_side=[id]),
        cascade="all, delete-orphan",
        single_parent=True,
    )


class Notification(Base):
    """In-app notification for a user (comment mentions/replies, etc.)."""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type = Column(String(64), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=True)
    link = Column(String(500), nullable=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    user = relationship("User")

    __table_args__ = (
        Index("ix_notifications_user_read", "user_id", "read_at"),
    )


class SavedReport(Base):
    """A saved custom-report definition (dimensions/metrics/filters)."""

    __tablename__ = "saved_reports"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String(200), nullable=False)
    # JSON-serialized {dimensions: [...], metrics: [...], filters: {...}}
    config = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=True)
    share_token = Column(String(64), unique=True, nullable=True, index=True)
    is_shared = Column(Boolean, nullable=False, default=False)

    owner = relationship("User")


class ManualEvaluation(Base):
    """Recruiter-authored manual evaluation / score override for a candidate."""

    __tablename__ = "manual_evaluations"

    id = Column(Integer, primary_key=True, index=True)
    evaluation_id = Column(
        Integer,
        ForeignKey("evaluations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recruiter_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    manual_score = Column(Float, nullable=False)          # 0-100 override score
    justification = Column(Text, nullable=True)            # recruiter free-text rationale
    skills_checklist = Column(Text, nullable=True)         # JSON: {skill_name: bool}
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=True)

    # Relationships
    evaluation = relationship("Evaluation")
    recruiter = relationship("User")


# ---------------------------------------------------------------------------
# Rate Limiting: DB-backed sliding window (multi-worker safe)
# ---------------------------------------------------------------------------

class RateLimitHit(Base):
    """Records each API hit for sliding-window rate limiting.

    Rows older than the relevant window are pruned on each check to keep the
    table small.  Suitable for deployments up to ~50 req/s before Redis is needed.
    """
    __tablename__ = "rate_limit_hits"

    id = Column(Integer, primary_key=True, index=True)
    ip = Column(String(45), nullable=False, index=True)
    path_prefix = Column(String(128), nullable=False, index=True)
    hit_at = Column(DateTime, nullable=False, default=_utcnow, index=True)

    __table_args__ = (
        Index("ix_rate_limit_hits_ip_prefix_time", "ip", "path_prefix", "hit_at"),
    )
